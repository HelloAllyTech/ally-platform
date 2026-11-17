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
  AgentMessage,
  AgentSystemBlock,
  AgentToolDefinition,
  AgentTurnResult,
} from 'src/llm-agent/type/agent-llm.type';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { PmAgentRunStepRepository } from '../repository/pm-agent.repositories';
import {
  actualCallUsd,
  estimateCallMaxUsd,
  PmRunLedger,
} from '../util/run-ledger';

/** One model target: what runs, and where a failure may retry. */
export interface PmLlmTarget {
  provider: string;
  model: string;
  /** The tier model on OpenAI, when it differs and a key exists here. */
  fallback?: { provider: string; model: string };
}

export interface PmLlmStepRequest {
  runId: string;
  /** Lane key (or `critic`) for the ledger's per-lane cap and the trace row. */
  lane: string;
  kind: 'lane' | 'critic';
  taskId: string;
  promptCode: string;
  promptVersion: number | null;
  target: PmLlmTarget;
  system: AgentSystemBlock[];
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  maxTokens: number;
  timeoutMs: number;
  ledger: PmRunLedger;
}

export type PmLlmStepResult =
  | {
      status: 'ok';
      turn: AgentTurnResult;
      provider: string;
      model: string;
      costUsd: number;
    }
  | { status: 'budget' }
  | { status: 'failed'; error: string };

/**
 * The seam between the pipeline and a model. Tests replace it with a scripted fake; the
 * pipeline never touches a provider SDK, a usage row or a ledger entry any other way.
 */
export interface PmLlmPort {
  resolveTarget(
    taskId: string,
    promptCode: string,
    cheap: boolean,
  ): Promise<PmLlmTarget>;
  loadPrompt(
    promptCode: string,
  ): Promise<{ text: string; version: number | null }>;
  step(request: PmLlmStepRequest): Promise<PmLlmStepResult>;
}

/** Retryable on another model: the provider is unusable, not the request. */
const isRetryable = (error: any): boolean => {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  if (typeof status === 'number') {
    return (
      status === 401 ||
      status === 403 ||
      status === 404 ||
      status === 408 ||
      status === 429 ||
      status >= 500
    );
  }
  return true;
};

const chars = (value: unknown): number => {
  try {
    return JSON.stringify(value ?? '').length;
  } catch {
    return 0;
  }
};

/**
 * Every PM Agent model call, metered and bounded.
 *
 * Per call, in this order: estimate the call's maximum cost from its prompt size and
 * `maxTokens`; RESERVE that in the run's ledger (no reservation, no call — this is what makes a
 * cap-full run cost nothing); call the provider with an SDK deadline; settle the reservation to
 * the actual cost; write one `llm_usage` row (task `pm_agent`) and one `pm_agent_run_steps` row
 * with the prompt code and version pinned.
 *
 * Model choice mirrors the roadmap copilot and LlmCompletionService: the prompt row's model in
 * the Skills Store wins, else the platform tier (REASONING for lanes and critic; FAST when the
 * budget degrades to a cheaper model). A provider with no key here is skipped for the tier
 * model; a call that fails on a usable-looking provider (a lapsed Anthropic credit, a 5xx) is
 * retried once on the tier model over OpenAI. Nothing is hard-coded to one vendor.
 */
@Injectable()
export class PmAgentLlmService implements PmLlmPort {
  private readonly logger = LoggerService.getInstance(PmAgentLlmService.name);

  constructor(
    private readonly resolver: LlmTargetResolverService,
    private readonly factory: AgentLlmProviderFactory,
    private readonly llmUsage: LlmUsageService,
    private readonly prompts: PromptSharedService,
    private readonly configService: AppConfigService,
    private readonly runSteps: PmAgentRunStepRepository,
  ) {}

  async loadPrompt(
    promptCode: string,
  ): Promise<{ text: string; version: number | null }> {
    const resolved = await this.prompts.resolvePrompt(promptCode);
    if (!resolved?.prompt) {
      throw new Error(`Prompt template not found: ${promptCode}`);
    }
    return { text: resolved.prompt, version: resolved.version };
  }

  async resolveTarget(
    taskId: string,
    promptCode: string,
    cheap: boolean,
  ): Promise<PmLlmTarget> {
    const tier = cheap ? LlmModelTier.FAST : LlmModelTier.REASONING;
    // A cheaper model is an explicit override: the prompt row's (stronger) model must not win.
    const resolved = await this.resolver.resolve({
      taskId,
      tier,
      promptCode,
      ...(cheap ? { model: this.configService.llmTiers[tier] } : {}),
    });
    const tierModel = resolved.tierModel;
    const tierProvider = providerForModel(tierModel) ?? 'openai';
    const provider =
      normaliseAgentProvider(resolved.provider) ??
      providerForModel(resolved.model);
    const fallback =
      tierModel !== resolved.model && this.factory.isConfigured(tierProvider)
        ? { provider: tierProvider, model: tierModel }
        : undefined;
    if (provider && this.factory.isConfigured(provider)) {
      return { provider, model: resolved.model, fallback };
    }
    if (this.factory.isConfigured(tierProvider)) {
      this.logger.warn(
        `[PM_AGENT] ${promptCode}: ${resolved.model} has no usable provider here; using ${tierModel}.`,
      );
      return { provider: tierProvider, model: tierModel };
    }
    throw new Error(
      `No provider key for ${resolved.model} or the tier model ${tierModel}.`,
    );
  }

  async step(request: PmLlmStepRequest): Promise<PmLlmStepResult> {
    const first = await this.attempt(
      request,
      request.target.provider,
      request.target.model,
    );
    if (
      first.status === 'failed' &&
      first.retryable &&
      request.target.fallback
    ) {
      this.logger.warn(
        `[PM_AGENT] ${request.taskId} on ${request.target.model} failed (${first.error}); retrying on ${request.target.fallback.model}.`,
      );
      const second = await this.attempt(
        request,
        request.target.fallback.provider,
        request.target.fallback.model,
      );
      return strip(second);
    }
    return strip(first);
  }

  private async attempt(
    request: PmLlmStepRequest,
    providerName: string,
    model: string,
  ): Promise<PmLlmStepResult & { retryable?: boolean }> {
    const inputChars =
      chars(request.system) + chars(request.messages) + chars(request.tools);
    const maxUsd = estimateCallMaxUsd(model, inputChars, request.maxTokens);
    const reservation = request.ledger.reserve(
      request.kind === 'critic' ? 'critic' : 'lane',
      request.lane,
      maxUsd,
    );
    if (!reservation) {
      await this.trace(request, model, null, 0, maxUsd, 'budget', null, {
        reason: 'could not reserve',
        maxUsd,
      });
      return { status: 'budget' };
    }

    const started = Date.now();
    let turn: AgentTurnResult | null = null;
    try {
      const provider = this.factory.create(providerName, model);
      for await (const event of provider.stream({
        model,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        maxTokens: request.maxTokens,
        timeoutMs: request.timeoutMs,
      })) {
        if (event.type === 'final') turn = event.message;
      }
      if (!turn) throw new Error(`${model} returned no response`);
    } catch (error) {
      // Nothing billable came back: the reservation is returned whole.
      request.ledger.release(reservation);
      const message = error instanceof Error ? error.message : String(error);
      await this.trace(request, model, null, 0, maxUsd, 'failed', started, {
        error: message.slice(0, 500),
      });
      return {
        status: 'failed',
        error: message,
        retryable: isRetryable(error),
      };
    }

    const costUsd = actualCallUsd(
      model,
      turn.usage.inputTokens,
      turn.usage.outputTokens,
      turn.usage.cachedTokens ?? 0,
    );
    request.ledger.settle(reservation, costUsd);
    void this.llmUsage.record({
      provider: providerName,
      model,
      task: LlmTask.PM_AGENT,
      promptTokens: turn.usage.inputTokens,
      completionTokens: turn.usage.outputTokens,
      totalTokens: turn.usage.inputTokens + turn.usage.outputTokens,
      cachedTokens: turn.usage.cachedTokens,
      cacheCreationTokens: turn.usage.cacheCreationTokens,
      metadata: {
        feature: 'pm-agent',
        aiTaskId: request.taskId,
        promptCode: request.promptCode,
        runId: request.runId,
        lane: request.lane,
      },
    });
    await this.trace(
      request,
      model,
      turn,
      costUsd,
      maxUsd,
      turn.stopReason === 'max_tokens' ? 'discarded' : 'ok',
      started,
      { stopReason: turn.stopReason, provider: providerName },
    );
    return { status: 'ok', turn, provider: providerName, model, costUsd };
  }

  private async trace(
    request: PmLlmStepRequest,
    model: string,
    turn: AgentTurnResult | null,
    costUsd: number,
    reservedUsd: number,
    outcome: 'ok' | 'discarded' | 'failed' | 'budget',
    started: number | null,
    detail: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.runSteps.insert({
        runId: request.runId,
        lane: request.lane.slice(0, 32),
        kind: request.kind,
        promptCode: request.promptCode,
        promptVersion: request.promptVersion,
        model: model.slice(0, 80),
        tokensIn: turn?.usage.inputTokens ?? 0,
        tokensOut: turn?.usage.outputTokens ?? 0,
        costUsd: costUsd.toFixed(4),
        reservedUsd: reservedUsd.toFixed(4),
        toolCalls: turn
          ? turn.content
              .filter((block) => block.type === 'tool_use')
              .map((block) => ({
                name: (block as { name: string }).name,
                input: JSON.stringify(
                  (block as { input: unknown }).input ?? {},
                ).slice(0, 300),
              }))
          : null,
        latencyMs: started ? Date.now() - started : null,
        outcome,
        detail: detail as never,
      });
    } catch (error) {
      // The trace must never be the reason a run fails.
      this.logger.warn(
        `[PM_AGENT] Run step trace failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function strip(
  result: PmLlmStepResult & { retryable?: boolean },
): PmLlmStepResult {
  if (result.status === 'failed') {
    return { status: 'failed', error: result.error };
  }
  return result;
}
