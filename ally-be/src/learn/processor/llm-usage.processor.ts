import { Injectable, Optional } from '@nestjs/common';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';
import { LoggerService } from 'src/logger/logger.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmUsageMessage } from '../interface/learn-message.interface';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { UsageEventService } from 'src/billing/service/usage-event.service';

/**
 * Persists token-usage rows (message_type "llm_usage") emitted by the Python
 * services into the `llm_usage` table, for the super-admin token-consumption
 * chart.
 *
 * Unlike TurnMetricsProcessor this does NOT require a scenario session —
 * autofill / translation / drift-judge / embedding events have no room. When a
 * `room_id` IS present (and not a preview), the session is resolved
 * best-effort only to backfill scenarioSessionId/tenantId; the row is persisted
 * regardless. A row that names a `scenario_session_id` but carries no tenant
 * (and resolved none from a room) gets the session's tenant the same way. Persistence is best-effort and does NOT rethrow: usage analytics
 * is loss-tolerant, so a DB hiccup should not retry-storm the SQS queue.
 */
@Injectable()
export class LlmUsageProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(LlmUsageProcessor.name);

  constructor(
    private readonly llmUsageService: LlmUsageService,
    private readonly scenarioSessionService: ScenarioSessionService,
    @Optional() private readonly usageEvents?: UsageEventService,
  ) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.LLM_USAGE;
  }

  async process(message: LlmUsageMessage): Promise<void> {
    const usage = message?.data?.llm_usage;

    if (!usage || !usage.model || !usage.task) {
      this.logger.warn(
        `LLM usage payload missing model/task (room=${message?.room_id ?? 'n/a'})`,
      );
      return;
    }

    // CR1: an assistant's call (ally-ai attributed it through X-Ally-Usage) is also a usage
    // event, priced and charged to the creator's tokens. Recorded FIRST and allowed to throw: a
    // failure redelivers the message, the event's unique key makes that safe, and the
    // loss-tolerant llm_usage row below is only written once this has succeeded.
    const attribution = UsageEventService.attributionOf(usage.metadata);
    if (attribution && this.usageEvents) {
      const service = usage.service ?? 'llm';
      await this.usageEvents.record({
        ...attribution,
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.prompt_tokens ?? 0,
        cachedTokens: usage.cached_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        units:
          service === 'stt' && usage.audio_ms
            ? usage.audio_ms / 60_000
            : service === 'tts' && usage.characters
              ? usage.characters / 1_000_000
              : null,
        unit:
          service === 'stt'
            ? 'minute'
            : service === 'tts'
              ? 'million_chars'
              : null,
        occurredAt: message.timestamp
          ? new Date(message.timestamp * 1000)
          : undefined,
        detail: { task: usage.task },
      });
    }

    // Best-effort enrichment from the room (when present) — never required.
    let scenarioSessionId = usage.scenario_session_id;
    let tenantId = usage.tenant_id;
    const roomId = message.room_id;
    if (roomId && !roomId.startsWith('preview-')) {
      const session = await this.scenarioSessionService
        .getScenarioSessionByRoomIdOrNull(roomId)
        .catch(() => null);
      if (session) {
        scenarioSessionId = scenarioSessionId ?? session.id;
        tenantId = tenantId ?? session.tenantId;
      }
    }

    // A row that names its session but no room — ally-ai's judges attribute
    // by scenario_session_id alone — still needs the session's tenant, or it
    // is stored tenantless and slips past test-org exclusion on every cost
    // chart. Same best-effort contract as the room path.
    if (!tenantId && scenarioSessionId) {
      tenantId =
        (await this.scenarioSessionService
          .getScenarioSessionTenantIdOrNull(scenarioSessionId)
          .catch(() => null)) ?? undefined;
    }

    await this.llmUsageService.record({
      service: (usage.service as 'llm' | 'stt' | 'tts') ?? 'llm',
      unit: usage.unit,
      provider: usage.provider,
      model: usage.model,
      task: usage.task,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      cachedTokens: usage.cached_tokens,
      audioMs: usage.audio_ms,
      characters: usage.characters,
      occurredAt: message.timestamp
        ? new Date(message.timestamp * 1000)
        : undefined,
      env: usage.env,
      tenantId,
      scenarioSessionId,
      roomId,
      metadata: usage.metadata,
    });
  }
}
