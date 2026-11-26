import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmModelTier } from 'src/llm/constants/llm-tier.constants';
import { LlmTargetResolverService } from 'src/llm/service/llm-target-resolver.service';
import {
  AgentLlmProviderFactory,
  normaliseAgentProvider,
  providerForModel,
} from 'src/llm-agent/service/agent-llm.factory';
import {
  AgentContentBlock,
  AgentMessage,
  AgentSystemBlock,
  AgentToolDefinition,
  AgentTurnResult,
} from 'src/llm-agent/type/agent-llm.type';
import {
  actualCallUsd,
  estimateCallMaxUsd,
  ManualSpendGate,
} from './manual-run-ledger';
import {
  MANUAL_LOOP_GUARD,
  MANUAL_TOOL_FAILURE_SENTENCES,
} from '../constants/manual-agent.constants';

/** Which model serves a loop, and where a failing provider may retry. */
export interface ManualTarget {
  provider: string;
  model: string;
  fallback?: { provider: string; model: string };
}

/** What a tool hands back: the model's text, the user's one-line summary, and whether it worked. */
export interface ManualToolOutcome {
  modelResult: string;
  summary: string;
  ok: boolean;
}

export type ManualLoopEvent =
  | { type: 'text'; text: string }
  | {
      type: 'tool_start';
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, any>;
      label: string;
    }
  | {
      type: 'tool_done';
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, any>;
      outcome: ManualToolOutcome;
    };

export type ManualLoopStatus =
  /** The model answered without asking for another tool. */
  | 'done'
  /** The iteration cap was reached with the model still asking for tools. */
  | 'iteration_cap'
  /** The caller's signal fired (client gone, run cancelled). */
  | 'aborted'
  /** The spend gate refused the next call. */
  | 'budget'
  /** The provider failed on the primary and (if any) the fallback model. */
  | 'provider_failed';

export interface ManualLoopResult {
  status: ManualLoopStatus;
  /** Every text block the model wrote, in order: what the user saw streamed. */
  text: string;
  iterations: number;
  costUsd: number;
  error?: string;
}

export interface ManualLoopRequest {
  /** AI task registry id: logged on each usage row. */
  taskId: string;
  usageTask: LlmTask;
  target: ManualTarget;
  system: AgentSystemBlock[];
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  maxIterations: number;
  maxTokens: number;
  timeoutMs: number;
  /**
   * When the cap is reached with tools still wanted, run one more pass that may not call tools
   * (`toolChoice: 'none'`, tools kept so the cached prefix holds), so a chat turn always ends in
   * an answer. The weekly agent leaves it off: a work item that ran out of iterations just stops.
   */
  closingPass?: boolean;
  execute(name: string, input: Record<string, any>): Promise<ManualToolOutcome>;
  describe(name: string, input: Record<string, any>): string;
  /** Merged into each llm_usage row's metadata (feature, conversationId | runId, userId …). */
  metadata: Record<string, unknown>;
  /** Reserve-before-spend; absent for chat turns. */
  gate?: ManualSpendGate;
  signal?: AbortSignal;
}

const CLOSING_NOTE =
  'You have used all the lookups for this turn. Answer now from what you have found, and say ' +
  'plainly if anything is still unchecked.';

const chars = (value: unknown): number => {
  try {
    return JSON.stringify(value ?? '').length;
  } catch {
    return 0;
  }
};

type ToolUse = Extract<AgentContentBlock, { type: 'tool_use' }>;

/**
 * The ONE tool loop the Product Manual's chat agent and weekly agent share (parameterised by system
 * prompt, tools, model task, iteration cap and usage label), on the provider-neutral agent client.
 *
 * Per pass: optionally reserve the call's worst case on the spend gate (no reservation, no call),
 * stream the pass, record one `llm_usage` row, settle the reservation. Tool calls in one pass run
 * together and are answered together in ONE user message of tool_result blocks — splitting them
 * teaches the model to stop calling in parallel. A tool never throws into the model: executors
 * return `{ok:false,error}`, and a throw is caught and turned into one here as a last resort.
 *
 * A provider failure retries the same pass once on the fallback model (the tier model, when it
 * differs and has a key here), provided no text of that pass reached the user yet.
 */
@Injectable()
export class ManualAgentCore {
  private readonly logger = LoggerService.getInstance(ManualAgentCore.name);

  constructor(
    private readonly resolver: LlmTargetResolverService,
    private readonly factory: AgentLlmProviderFactory,
    private readonly llmUsage: LlmUsageService,
  ) {}

  /**
   * Tier REASONING through the resolver (an explicit override, else the tier). The provider follows
   * from the model id when none is named. A provider with no key here falls to the tier model.
   */
  async resolveTarget(taskId: string): Promise<ManualTarget> {
    const resolved = await this.resolver.resolve({
      taskId,
      tier: LlmModelTier.REASONING,
    });
    const tierModel = resolved.tierModel;
    const tierProvider = providerForModel(tierModel) ?? 'openai';
    const provider =
      normaliseAgentProvider(resolved.provider) ??
      providerForModel(resolved.model);
    const fallback =
      resolved.fallbackEnabled &&
      tierModel !== resolved.model &&
      this.factory.isConfigured(tierProvider)
        ? { provider: tierProvider, model: tierModel }
        : undefined;
    if (provider && this.factory.isConfigured(provider)) {
      return { provider, model: resolved.model, fallback };
    }
    if (this.factory.isConfigured(tierProvider)) {
      return { provider: tierProvider, model: tierModel };
    }
    throw new Error(
      `No provider key for ${resolved.model} or the tier model ${tierModel}.`,
    );
  }

  async *run(
    request: ManualLoopRequest,
  ): AsyncGenerator<ManualLoopEvent, ManualLoopResult> {
    const messages: AgentMessage[] = [...request.messages];
    let target: { provider: string; model: string } = request.target;
    let fallbackUsed = !request.target.fallback;
    let text = '';
    let costUsd = 0;
    let iterations = 0;
    let retriedInvalid = false;
    const maxPasses = request.maxIterations + (request.closingPass ? 1 : 0);
    // The anti-loop guard: a call that failed is not run again with the same input, and a tool
    // that has failed MANUAL_LOOP_GUARD.FAILURES_BEFORE_WITHHOLD times is refused for the rest of
    // the run. Refused, not removed from the tool list: removing a definition mid-turn changes the
    // request prefix, which invalidates the cache and earlier thinking blocks.
    const failedCalls = new Set<string>();
    const failuresByTool = new Map<string, number>();

    while (iterations < maxPasses) {
      if (request.signal?.aborted) {
        return { status: 'aborted', text, iterations, costUsd };
      }
      const closing = iterations >= request.maxIterations;
      iterations += 1;

      let turn: AgentTurnResult | null = null;
      for (;;) {
        const pass = yield* this.pass(request, target, messages, {
          iteration: iterations,
          closing,
        });
        if (pass.status === 'ok') {
          turn = pass.turn;
          text += pass.text;
          costUsd += pass.costUsd;
          break;
        }
        if (pass.status === 'budget') {
          text += pass.text;
          return { status: 'budget', text, iterations, costUsd };
        }
        if (pass.status === 'aborted') {
          text += pass.text;
          return { status: 'aborted', text, iterations, costUsd };
        }
        // Failed. Retry once on the fallback, unless the user already saw part of this pass.
        if (!fallbackUsed && !pass.text && request.target.fallback) {
          fallbackUsed = true;
          this.logger.warn(
            `[PRODUCT_MANUAL] ${request.taskId} on ${target.model} failed (${pass.error}); retrying on ${request.target.fallback.model}.`,
          );
          target = request.target.fallback;
          continue;
        }
        text += pass.text;
        return {
          status: 'provider_failed',
          text,
          iterations,
          costUsd,
          error: pass.error,
        };
      }

      if (turn.stopReason === 'invalid_tool_call' && !retriedInvalid) {
        // Transient on some providers; the same request usually succeeds. Counts as a pass.
        retriedInvalid = true;
        continue;
      }
      if (turn.stopReason === 'pause_turn') {
        messages.push({ role: 'assistant', content: turn.content });
        continue;
      }

      // A pass cut off at max_tokens may end in a half-written tool call: nothing in it is run.
      const toolUses: ToolUse[] =
        turn.stopReason === 'max_tokens' || closing
          ? []
          : turn.content.filter((b): b is ToolUse => b.type === 'tool_use');
      if (!toolUses.length) {
        const askedForTools = turn.content.some((b) => b.type === 'tool_use');
        return {
          status: closing && askedForTools ? 'iteration_cap' : 'done',
          text,
          iterations,
          costUsd,
        };
      }

      const started = toolUses.map((use, index) => ({
        use,
        id: `${use.id || 'tool'}:${iterations}:${index}`,
        label: safe(
          () => request.describe(use.name, use.input ?? {}),
          use.name,
        ),
      }));
      for (const { use, id, label } of started) {
        yield {
          type: 'tool_start',
          id,
          toolUseId: use.id,
          name: use.name,
          input: use.input ?? {},
          label,
        };
      }
      const outcomes = await Promise.all(
        started.map(({ use }) => {
          if (
            (failuresByTool.get(use.name) ?? 0) >=
            MANUAL_LOOP_GUARD.FAILURES_BEFORE_WITHHOLD
          ) {
            return Promise.resolve(
              refusal(
                MANUAL_LOOP_GUARD.WITHHELD_ERROR,
                MANUAL_TOOL_FAILURE_SENTENCES.withheld,
              ),
            );
          }
          if (failedCalls.has(callKey(use))) {
            return Promise.resolve(
              refusal(
                MANUAL_LOOP_GUARD.REPEAT_ERROR,
                MANUAL_TOOL_FAILURE_SENTENCES.repeated,
              ),
            );
          }
          return this.executeSafely(request, use);
        }),
      );
      for (const [index, { use }] of started.entries()) {
        if (outcomes[index].ok) continue;
        failedCalls.add(callKey(use));
        failuresByTool.set(use.name, (failuresByTool.get(use.name) ?? 0) + 1);
      }
      for (const [index, { use, id }] of started.entries()) {
        yield {
          type: 'tool_done',
          id,
          toolUseId: use.id,
          name: use.name,
          input: use.input ?? {},
          outcome: outcomes[index],
        };
      }

      messages.push({ role: 'assistant', content: turn.content });
      const results: AgentContentBlock[] = started.map(({ use }, index) => ({
        type: 'tool_result' as const,
        tool_use_id: use.id,
        content: outcomes[index].modelResult,
        ...(outcomes[index].ok ? {} : { is_error: true }),
      }));
      if (request.closingPass && iterations >= request.maxIterations) {
        results.push({ type: 'text', text: CLOSING_NOTE });
      }
      messages.push({ role: 'user', content: results });
    }

    return { status: 'iteration_cap', text, iterations, costUsd };
  }

  private async executeSafely(
    request: ManualLoopRequest,
    use: ToolUse,
  ): Promise<ManualToolOutcome> {
    try {
      return await request.execute(use.name, use.input ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[PRODUCT_MANUAL] Tool ${use.name} threw (caught): ${message}`,
      );
      return {
        modelResult: JSON.stringify({ ok: false, error: message }),
        summary: MANUAL_TOOL_FAILURE_SENTENCES.threw,
        ok: false,
      };
    }
  }

  /** One model pass: reserve, stream (text out as it arrives), record usage, settle. */
  private async *pass(
    request: ManualLoopRequest,
    target: { provider: string; model: string },
    messages: AgentMessage[],
    pass: { iteration: number; closing: boolean },
  ): AsyncGenerator<
    ManualLoopEvent,
    | { status: 'ok'; turn: AgentTurnResult; text: string; costUsd: number }
    | { status: 'budget'; text: string }
    | { status: 'aborted'; text: string }
    | { status: 'failed'; text: string; error: string }
  > {
    const reservation = request.gate
      ? request.gate.reserve(
          estimateCallMaxUsd(
            target.model,
            chars(request.system) + chars(messages) + chars(request.tools),
            request.maxTokens,
          ),
        )
      : null;
    if (request.gate && !reservation) return { status: 'budget', text: '' };

    let text = '';
    let turn: AgentTurnResult | null = null;
    try {
      const provider = this.factory.create(target.provider, target.model);
      for await (const event of provider.stream({
        model: target.model,
        system: request.system,
        messages,
        maxTokens: request.maxTokens,
        timeoutMs: request.timeoutMs,
        ...(request.tools.length ? { tools: request.tools } : {}),
        ...(pass.closing && request.tools.length
          ? { toolChoice: 'none' as const }
          : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      })) {
        if (event.type === 'text_delta') {
          text += event.text;
          yield { type: 'text', text: event.text };
        } else if (event.type === 'final') {
          turn = event.message;
        }
      }
      if (!turn) throw new Error(`${target.model} returned no response`);
    } catch (error) {
      if (reservation) request.gate!.release(reservation);
      if (request.signal?.aborted) return { status: 'aborted', text };
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[PRODUCT_MANUAL] ${request.taskId} pass ${pass.iteration} on ${target.model} failed: ${message}`,
      );
      return { status: 'failed', text, error: message };
    }

    const costUsd = actualCallUsd(
      target.model,
      turn.usage.inputTokens,
      turn.usage.outputTokens,
      turn.usage.cachedTokens ?? 0,
    );
    if (reservation) request.gate!.settle(reservation, costUsd);
    void this.llmUsage.record({
      provider: target.provider,
      model: target.model,
      task: request.usageTask,
      promptTokens: turn.usage.inputTokens,
      completionTokens: turn.usage.outputTokens,
      totalTokens: turn.usage.inputTokens + turn.usage.outputTokens,
      cachedTokens: turn.usage.cachedTokens,
      cacheCreationTokens: turn.usage.cacheCreationTokens,
      metadata: {
        feature: 'product-manual',
        aiTaskId: request.taskId,
        ...request.metadata,
        iteration: pass.iteration,
      },
    });
    return { status: 'ok', turn, text, costUsd };
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const refusal = (error: string, summary: string): ManualToolOutcome => ({
  modelResult: JSON.stringify({ ok: false, error }),
  summary,
  ok: false,
});

/** Tool name + its input with keys sorted and strings trimmed, lower-cased and squashed. */
export function callKey(use: { name: string; input?: unknown }): string {
  return `${use.name}:${JSON.stringify(normaliseInput(use.input ?? {}))}`;
}

function normaliseInput(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }
  if (Array.isArray(value)) return value.map(normaliseInput);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normaliseInput((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}
