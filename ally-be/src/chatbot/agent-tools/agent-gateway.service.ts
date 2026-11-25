import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { DataSource } from 'typeorm';
import { isServiceKey } from '../../common/util/service-key';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { ToolRunStatus } from '../entity/tool-run.entity';
import type { ChatbotSettingsOverride } from '../type/chatbot.type';
import { AgentRunTokenService } from './agent-run-token.service';
import { abilityFor } from './list-tools';
import type { WriteOffer } from './list-consent';
import { ListToolsService } from './list-tools.service';
import {
  AgentToolOutcome,
  AgentToolRegistry,
  type AgentToolContext,
} from './tools';

/** The highest step a run can call at: ally-ai allows at most 4 tool steps per run. */
export const MAX_TOOL_STEP = 3;

/** A `started` row this old is a call that died mid-run; the next call may claim it again. */
export const STALE_CLAIM_SECONDS = 30;

/** What every gateway call answers. */
export type AgentGatewayResponse =
  | { ok: true; result: Record<string, unknown>; replayed: boolean }
  | {
      ok: false;
      error: string;
      result?: Record<string, unknown>;
      replayed: boolean;
    };

interface ToolRunRow {
  id: string;
  chatbot_id: string;
  tool: string;
  status: ToolRunStatus;
  result: Record<string, unknown> | null;
  error_code: string | null;
}

/** The rows an `INSERT/UPDATE … RETURNING` run through `query` returned (Postgres: [rows, count]). */
function rowsOf(result: unknown): { id: string }[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as { id: string }[];
}

/**
 * The chatbot agent's tool gateway (chunk 3b): ally-ai decides, ally-be acts. Each call is checked
 * in a fixed order (the service key, the run token, the tool, the bot's abilities, the body), then
 * claimed in `tool_runs` before it runs, so a replay of the same run id and step returns what was
 * done rather than doing it again.
 *
 * Logs carry the tool, status and milliseconds only: never inputs, results or the token.
 */
@Injectable()
export class AgentGatewayService {
  private readonly logger = LoggerService.getInstance(AgentGatewayService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    private readonly tokens: AgentRunTokenService,
    private readonly registry: AgentToolRegistry,
    private readonly listTools: ListToolsService,
  ) {}

  async call(
    name: string,
    headers: { apiKey?: string | string[]; authorization?: string },
    body: unknown,
  ): Promise<AgentGatewayResponse> {
    // 1. The service secret: the key ally-be already sends ally-ai.
    if (!isServiceKey(headers.apiKey, this.config.ai.outboundApiKey)) {
      throw new UnauthorizedException('Service key missing or wrong');
    }
    // 2. The run token: signature, expiry and kind.
    const claims = this.tokens.verify(headers.authorization);
    // 3. The tool: a built-in one, or a live list of the token's bot (chunk 6). No other bot's.
    const tool =
      this.registry.get(name) ??
      (await this.listTools.resolve(claims.chatbotId, name));
    if (!tool) throw new NotFoundException(`No agent tool ${name}`);
    // 4. The token lists it, and the bot still has it on.
    if (!claims.tools.includes(name)) {
      throw new ForbiddenException(`This run may not call ${name}`);
    }
    if (
      abilityFor(await this.storedSettings(claims.chatbotId), name) !==
        'do_it' &&
      // TF1 B4: a request's withdraw-only change, allowed while Change is Never.
      !(await this.listTools.withdrawOnly?.(claims.chatbotId, name))
    ) {
      throw new ForbiddenException(`${name} is off for this assistant`);
    }
    // 5. The body: exactly { run_id, step, input }.
    const { runId, step, input } = this.parseBody(body);
    if (runId !== claims.runId) {
      throw new ForbiddenException('The body names another run');
    }
    const parsed = tool.parse(input);

    const ctx: AgentToolContext = {
      chatbotId: claims.chatbotId,
      conversationId: claims.conversationId,
      runId: claims.runId,
      contactId: claims.contactId,
      consentOfferId: claims.consent ?? null,
    };
    return this.execute(ctx, step, name, input, () => tool.run(ctx, parsed));
  }

  /**
   * Claim the step, run the tool once, record what it did (chunk 3b). A step already done is
   * replayed, never run again: the agent's retries and BT1's double taps write once.
   */
  private async execute(
    ctx: AgentToolContext,
    step: number,
    name: string,
    input: Record<string, unknown>,
    run: () => Promise<AgentToolOutcome>,
  ): Promise<AgentGatewayResponse> {
    const claimed = await this.claim(ctx, step, name, input);
    if ('replay' in claimed) {
      this.logger.info(
        `[AGENT TOOL] ${name} replayed (${claimed.replay.ok ? 'ok' : 'error'}) run=${ctx.runId} step=${step}`,
      );
      return { ...claimed.replay, replayed: true };
    }

    const startedAt = Date.now();
    let outcome: AgentToolOutcome;
    try {
      outcome = await run();
    } catch (error) {
      this.logger.warn(
        `[AGENT TOOL] ${name} threw ${error instanceof Error ? error.name : 'an error'}`,
      );
      outcome = { ok: false, error: 'internal' };
    }
    const ms = Date.now() - startedAt;
    await this.dataSource.query(
      `UPDATE tool_runs
          SET status = $2, result = $3, error_code = $4, duration_ms = $5, "updatedAt" = now()
        WHERE id = $1`,
      [
        claimed.id,
        outcome.ok ? ToolRunStatus.OK : ToolRunStatus.ERROR,
        outcome.result ? JSON.stringify(outcome.result) : null,
        outcome.ok ? null : outcome.error,
        ms,
      ],
    );
    this.logger.info(
      `[AGENT TOOL] ${name} ${outcome.ok ? 'ok' : 'error'} in ${ms}ms run=${ctx.runId} step=${step}` +
        (outcome.ok ? '' : ` error=${outcome.error}`),
    );
    return { ...outcome, replayed: false };
  }

  /**
   * BT1: a chip that completes a write waiting for a choice (the service). The write is proposed
   * through the same tool, never written: with no consent the gateway stores an offer and answers
   * `needs_confirmation`, and the card is built from it. No model call.
   */
  async proposeWrite(
    ctx: Pick<AgentToolContext, 'chatbotId' | 'conversationId' | 'contactId'>,
    name: string,
    input: Record<string, string | number>,
  ): Promise<AgentGatewayResponse & { runId: string }> {
    const runId = randomUUID();
    const tool =
      this.registry.get(name) ??
      (await this.listTools.resolve(ctx.chatbotId, name));
    if (!tool) return { ok: false, error: 'not_found', replayed: false, runId };
    if (
      abilityFor(await this.storedSettings(ctx.chatbotId), name) !== 'do_it'
    ) {
      return { ok: false, error: 'tool_off', replayed: false, runId };
    }
    const runCtx: AgentToolContext = { ...ctx, runId, consentOfferId: null };
    const parsed = tool.parse(input);
    const out = await this.execute(runCtx, 0, name, input, () =>
      tool.run(runCtx, parsed),
    );
    return { ...out, runId };
  }

  /**
   * BT1: a Confirm tap. The offer the person tapped is written through the same tool, list rules,
   * per-person scope and consent check as the agent's own write, with no model call: the tap is
   * the yes (the offer's id is the consent), and the run id comes from the offer, so a second tap
   * replays the first one's result instead of writing again. The tool must still be on ("Do it").
   */
  async confirmOffer(
    ctx: Pick<AgentToolContext, 'chatbotId' | 'conversationId' | 'contactId'>,
    offer: WriteOffer,
  ): Promise<AgentGatewayResponse> {
    if (!offer.input) {
      return { ok: false, error: 'not_tappable', replayed: false };
    }
    const tool =
      this.registry.get(offer.tool) ??
      (await this.listTools.resolve(ctx.chatbotId, offer.tool));
    if (!tool) return { ok: false, error: 'not_found', replayed: false };
    if (
      abilityFor(await this.storedSettings(ctx.chatbotId), offer.tool) !==
        'do_it' &&
      !(await this.listTools.withdrawOnly?.(ctx.chatbotId, offer.tool))
    ) {
      return { ok: false, error: 'tool_off', replayed: false };
    }
    const runCtx: AgentToolContext = {
      ...ctx,
      runId: tapRunIdFor(offer.id),
      consentOfferId: offer.id,
    };
    const parsed = tool.parse(offer.input);
    return this.execute(runCtx, 0, offer.tool, offer.input, () =>
      tool.run(runCtx, parsed),
    );
  }

  /** The bot's own stored overrides: where `abilities` lives. A missing bot has nothing on. */
  private async storedSettings(
    chatbotId: string,
  ): Promise<ChatbotSettingsOverride | null> {
    const [row] = (await this.dataSource.query(
      `SELECT settings FROM chatbots WHERE id = $1`,
      [chatbotId],
    )) as { settings: ChatbotSettingsOverride | null }[];
    return row?.settings ?? null;
  }

  private parseBody(body: unknown): {
    runId: string;
    step: number;
    input: Record<string, unknown>;
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('The body must be an object');
    }
    const b = body as Record<string, unknown>;
    const unknown = Object.keys(b).filter(
      (key) => !['run_id', 'step', 'input'].includes(key),
    );
    if (unknown.length) {
      throw new BadRequestException(`Unknown fields: ${unknown.join(', ')}`);
    }
    if (typeof b.run_id !== 'string' || !b.run_id) {
      throw new BadRequestException('run_id is required');
    }
    if (
      typeof b.step !== 'number' ||
      !Number.isInteger(b.step) ||
      b.step < 0 ||
      b.step > MAX_TOOL_STEP
    ) {
      throw new BadRequestException(
        `step must be a whole number from 0 to ${MAX_TOOL_STEP}`,
      );
    }
    const input = b.input ?? {};
    if (typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('input must be an object');
    }
    return {
      runId: b.run_id,
      step: b.step,
      input: input as Record<string, unknown>,
    };
  }

  /**
   * Claim this run's step before the tool runs. A step already done is replayed whatever the input
   * says now (a model rephrases on a replay, but what was done stands); another tool or bot at the
   * same step is a conflict; a claim left `started` for 30 s is taken over.
   */
  private async claim(
    ctx: AgentToolContext,
    step: number,
    tool: string,
    input: Record<string, unknown>,
  ): Promise<{ id: string } | { replay: AgentToolOutcome }> {
    const [inserted] = rowsOf(
      await this.dataSource.query(
        `INSERT INTO tool_runs (chatbot_id, conversation_id, run_id, step, tool, input, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (run_id, step) DO NOTHING
         RETURNING id`,
        [
          ctx.chatbotId,
          ctx.conversationId,
          ctx.runId,
          step,
          tool,
          JSON.stringify(input),
          ToolRunStatus.STARTED,
        ],
      ),
    );
    if (inserted) return { id: inserted.id };

    const [existing] = (await this.dataSource.query(
      `SELECT id, chatbot_id, tool, status, result, error_code
         FROM tool_runs WHERE run_id = $1 AND step = $2`,
      [ctx.runId, step],
    )) as ToolRunRow[];
    if (!existing) {
      // Deleted between the insert and the read (erasure): nothing to replay, nothing to claim.
      throw new ConflictException({ errorCode: 'in_progress' });
    }
    if (existing.tool !== tool || existing.chatbot_id !== ctx.chatbotId) {
      throw new ConflictException({
        errorCode: 'step_taken',
        message: 'Another tool already ran at this step',
      });
    }
    if (existing.status === ToolRunStatus.OK) {
      return { replay: { ok: true, result: existing.result ?? {} } };
    }
    if (existing.status === ToolRunStatus.ERROR) {
      return {
        replay: {
          ok: false,
          error: existing.error_code ?? 'internal',
          ...(existing.result ? { result: existing.result } : {}),
        },
      };
    }
    const [reclaimed] = rowsOf(
      await this.dataSource.query(
        `UPDATE tool_runs SET input = $2, "updatedAt" = now()
          WHERE id = $1 AND status = $3
            AND "updatedAt" < now() - make_interval(secs => $4)
          RETURNING id`,
        [
          existing.id,
          JSON.stringify(input),
          ToolRunStatus.STARTED,
          STALE_CLAIM_SECONDS,
        ],
      ),
    );
    if (reclaimed) return { id: reclaimed.id };
    throw new ConflictException({
      errorCode: 'in_progress',
      message: 'This step is already running',
    });
  }
}

/** BT1: a Confirm tap's run id, the same for every tap on one offer (the replay key). */
export function tapRunIdFor(offerId: string): string {
  return uuidv5(`tap:${offerId}`, TAP_RUN_NAMESPACE);
}
const TAP_RUN_NAMESPACE = '4c3f7d61-6b0e-4b8f-9a55-2f1f7e0bd3a1';
