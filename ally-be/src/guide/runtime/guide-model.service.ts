import { Injectable } from '@nestjs/common';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { AgentCostLedgerService } from 'src/llm-agent/harness/budget/agent-cost-ledger.service';
import { AgentLlmProviderFactory } from 'src/llm-agent/service/agent-llm.factory';
import {
  AgentStreamEvent,
  AgentStreamRequest,
  AgentTurnResult,
} from 'src/llm-agent/type/agent-llm.type';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideBudgetTier,
  GuideChannelRoute,
  GuideModelRoute,
  GuideReleaseBundle,
  GuideRole,
} from '../release/guide-release.bundle';

/** Who a call is for, recorded on every usage and ledger line. */
export interface GuideCallAttribution {
  threadId?: string | null;
  turnId?: string | null;
  userId?: number | null;
  visitorId?: string | null;
  tenantId?: string | null;
  releaseId?: string | null;
}

export interface GuideModelCall {
  role: GuideRole;
  bundle: GuideReleaseBundle;
  channel?: GuideChannelRoute;
  tier?: GuideBudgetTier;
  /** Everything but the model and effort, which come from the release. */
  request: Omit<AgentStreamRequest, 'model' | 'effort'>;
  task: LlmTask;
  /** The AI task registry row id (`GUIDE_AI_TASKS`). */
  aiTaskId: string;
  attribution: GuideCallAttribution;
  /** Told each call's priced cost once it is recorded. */
  onCost?: (usd: number) => void;
}

export interface GuideModelResult {
  result: AgentTurnResult;
  route: GuideModelRoute;
  usd: number;
  latencyMs: number;
}

/**
 * The one way the guide calls a model (plans/ally-guide/plan.md §7.7).
 *
 * The model is never named at a call site: each role's route comes from the
 * thread's release (`modelRouting` role → channel → budget tier), so swapping
 * a model is a release, and degrading under budget is a tier. Every call is
 * recorded twice, for two readers: `llm_usage` for platform spend analytics
 * (AI Tasks, cost charts) and the harness cost ledger, which the guide reads
 * back for its budget tiers.
 */
@Injectable()
export class GuideModelService {
  private readonly logger = LoggerService.getInstance(GuideModelService.name);
  private readonly override: GuideModelRoute | null;

  constructor(
    private readonly providers: AgentLlmProviderFactory,
    private readonly usage: LlmUsageService,
    private readonly ledger: AgentCostLedgerService,
    config: AppConfigService,
  ) {
    const override = config.allyGuideModelOverride;
    this.override = override
      ? {
          provider: override.provider as GuideModelRoute['provider'],
          model: override.model,
        }
      : null;
    if (this.override) {
      this.logger.warn(
        `ALLY_GUIDE_MODEL_OVERRIDE: every guide role runs on ${this.override.provider}:${this.override.model} (local only)`,
      );
    }
  }

  /** The route for a role, falling back to its text/premium route. */
  route(
    bundle: GuideReleaseBundle,
    role: GuideRole,
    channel: GuideChannelRoute = 'text',
    tier: GuideBudgetTier = 'premium',
  ): GuideModelRoute {
    if (this.override) return this.override;
    const byChannel = bundle.modelRouting[role];
    const route =
      byChannel?.[channel]?.[tier] ??
      byChannel?.text?.[tier] ??
      byChannel?.[channel]?.premium ??
      byChannel?.text?.premium;
    if (!route) {
      throw new Error(`The release routes no model for the ${role} role`);
    }
    return route;
  }

  /** Stream a call; usage is recorded when the final message arrives. */
  async *stream(call: GuideModelCall): AsyncGenerator<AgentStreamEvent> {
    const route = this.route(call.bundle, call.role, call.channel, call.tier);
    const provider = this.providers.create(route.provider, route.model);
    const startedAt = Date.now();
    for await (const event of provider.stream({
      ...call.request,
      model: route.model,
      ...(route.effort ? { effort: route.effort } : {}),
    })) {
      if (event.type === 'final') {
        const usd = await this.account(
          call,
          route,
          event.message,
          Date.now() - startedAt,
        );
        call.onCost?.(usd);
      }
      yield event;
    }
  }

  /** Run a call to completion. */
  async complete(call: GuideModelCall): Promise<GuideModelResult> {
    const route = this.route(call.bundle, call.role, call.channel, call.tier);
    const provider = this.providers.create(route.provider, route.model);
    const startedAt = Date.now();
    let final: AgentTurnResult | undefined;
    for await (const event of provider.stream({
      ...call.request,
      model: route.model,
      ...(route.effort ? { effort: route.effort } : {}),
    })) {
      if (event.type === 'final') final = event.message;
    }
    if (!final) throw new Error(`${call.role} call ended without a result`);
    const latencyMs = Date.now() - startedAt;
    const usd = await this.account(call, route, final, latencyMs);
    call.onCost?.(usd);
    return { result: final, route, usd, latencyMs };
  }

  private async account(
    call: GuideModelCall,
    route: GuideModelRoute,
    result: AgentTurnResult,
    latencyMs: number,
  ): Promise<number> {
    const { usage } = result;
    const input = usage?.inputTokens ?? 0;
    const output = usage?.outputTokens ?? 0;
    void this.usage.record({
      provider: route.provider,
      model: route.model,
      task: call.task,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      cachedTokens: usage?.cachedTokens ?? undefined,
      cacheCreationTokens: usage?.cacheCreationTokens ?? undefined,
      tenantId: call.attribution.tenantId ?? undefined,
      metadata: {
        aiTaskId: call.aiTaskId,
        guideRole: call.role,
        guideThreadId: call.attribution.threadId ?? null,
        guideTurnId: call.attribution.turnId ?? null,
        releaseId: call.attribution.releaseId ?? null,
        latencyMs,
        stopReason: result.stopReason,
      },
    });
    return this.ledger.record({
      agentKey: ALLY_GUIDE_AGENT_KEY,
      role: call.role,
      provider: route.provider,
      model: route.model,
      usage,
      threadId: call.attribution.threadId,
      turnId: call.attribution.turnId,
      userId: call.attribution.userId,
      visitorId: call.attribution.visitorId,
      tenantId: call.attribution.tenantId,
    });
  }
}
