import { BadRequestException } from '@nestjs/common';
import { ToolRunStatus } from '../../entity/tool-run.entity';
import type { ChatbotSettingsOverride } from '../../type/chatbot.type';
import { AgentGatewayService } from '../agent-gateway.service';
import { AgentRunTokenService } from '../agent-run-token.service';
import {
  AgentGatewayTool,
  AgentToolContext,
  AgentToolOutcome,
  AgentToolRegistry,
} from '../tools';

export const SERVICE_KEY = 'service-key';
export const BOT_A = '11111111-1111-4111-8111-111111111111';
export const BOT_B = '22222222-2222-4222-8222-222222222222';
export const CONV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CONV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const appConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    agentGatewaySecret: '',
    debriefGatewaySecret: '',
    publicApiBaseUrl: 'http://host.docker.internal:8001/',
    jwt: { accessToken: { secret: 'access-secret' } },
    ai: { outboundApiKey: SERVICE_KEY },
    ...overrides,
  }) as never;

export interface FakeToolRun {
  id: string;
  chatbot_id: string;
  conversation_id: string;
  run_id: string;
  step: number;
  tool: string;
  input: Record<string, unknown>;
  status: ToolRunStatus;
  result: Record<string, unknown> | null;
  error_code: string | null;
  duration_ms: number | null;
  updatedAt: Date;
}

/**
 * The few queries the gateway sends, answered from memory: the bots' stored settings, and
 * `tool_runs` with its unique (run_id, step). Real Postgres runs the same SQL in
 * `agent-gateway.pg.spec.ts`.
 */
export class FakeGatewayDb {
  readonly bots = new Map<string, ChatbotSettingsOverride | null>();
  readonly runs: FakeToolRun[] = [];
  /** The platform settings row, which the gateway must never read abilities from. */
  readonly platformSettings: Record<string, unknown> = {};
  private nextId = 1;

  async query(sql: string, params: unknown[] = []): Promise<unknown> {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT settings FROM chatbots')) {
      const id = params[0] as string;
      return this.bots.has(id) ? [{ settings: this.bots.get(id) }] : [];
    }
    if (s.startsWith('INSERT INTO tool_runs')) {
      const [chatbotId, conversationId, runId, step, tool, input, status] =
        params as [string, string, string, number, string, string, string];
      if (this.find(runId, step)) return [];
      const id = `run-row-${this.nextId++}`;
      this.runs.push({
        id,
        chatbot_id: chatbotId,
        conversation_id: conversationId,
        run_id: runId,
        step,
        tool,
        input: JSON.parse(input),
        status: status as ToolRunStatus,
        result: null,
        error_code: null,
        duration_ms: null,
        updatedAt: new Date(),
      });
      return [{ id }];
    }
    if (
      s.startsWith(
        'SELECT id, chatbot_id, tool, status, result, error_code FROM tool_runs',
      )
    ) {
      const row = this.find(params[0] as string, params[1] as number);
      return row ? [row] : [];
    }
    if (s.startsWith('UPDATE tool_runs SET input')) {
      const [id, input, status, secs] = params as [
        string,
        string,
        string,
        number,
      ];
      const row = this.runs.find((r) => r.id === id);
      if (
        !row ||
        row.status !== status ||
        row.updatedAt.getTime() >= Date.now() - secs * 1000
      ) {
        return [[], 0];
      }
      row.input = JSON.parse(input);
      row.updatedAt = new Date();
      return [[{ id }], 1];
    }
    if (s.startsWith('UPDATE tool_runs SET status')) {
      const [id, status, result, errorCode, ms] = params as [
        string,
        ToolRunStatus,
        string | null,
        string | null,
        number,
      ];
      const row = this.runs.find((r) => r.id === id)!;
      Object.assign(row, {
        status,
        result: result ? JSON.parse(result) : null,
        error_code: errorCode,
        duration_ms: ms,
        updatedAt: new Date(),
      });
      return [[], 1];
    }
    throw new Error(`FakeGatewayDb: unexpected query ${s.slice(0, 80)}`);
  }

  private find(runId: string, step: number) {
    return this.runs.find((r) => r.run_id === runId && r.step === step);
  }
}

/** A tool that records its calls and answers what it's told. */
export class RecordingTool implements AgentGatewayTool<{ note: string }> {
  readonly calls: { ctx: AgentToolContext; input: { note: string } }[] = [];
  outcome: AgentToolOutcome = { ok: true, result: { done: true } };

  constructor(readonly name: string) {}

  parse(input: Record<string, unknown>) {
    const extra = Object.keys(input).filter((k) => k !== 'note');
    if (extra.length) {
      // As a real tool does: unknown fields are refused.
      throw new BadRequestException(`Unknown fields: ${extra.join(', ')}`);
    }
    return { note: String(input.note ?? '') };
  }

  async run(ctx: AgentToolContext, input: { note: string }) {
    this.calls.push({ ctx, input });
    return this.outcome;
  }
}

/** List tools (chunk 6): none resolve unless a test adds them. */
export class FakeListTools {
  readonly tools = new Map<string, AgentGatewayTool>();
  async resolve(chatbotId: string, name: string) {
    return this.tools.get(`${chatbotId}:${name}`);
  }
}

export function makeGateway(
  tools: AgentGatewayTool[],
  config = appConfig(),
  listTools = new FakeListTools(),
) {
  const db = new FakeGatewayDb();
  const tokens = new AgentRunTokenService(config);
  const gateway = new AgentGatewayService(
    db as never,
    config,
    tokens,
    new AgentToolRegistry(tools),
    listTools as never,
  );
  return { db, tokens, gateway, listTools };
}
