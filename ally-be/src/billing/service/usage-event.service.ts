import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { BillingModel } from '../entity/billing-model.entity';
import { BillingModelPrice } from '../entity/billing-model-price.entity';
import { UsageEvent } from '../entity/usage-event.entity';
import {
  ALLY_PAID_USAGE_KINDS,
  UsageChannel,
  UsageKind,
} from '../enum/billing.enum';
import {
  canonicalBillingProvider,
  costMicros,
  priceAt,
} from '../util/pricing.util';
import { fallbackCostMicros } from '../constants/credits.constants';
import { AI_TASK_REGISTRY } from 'src/llm/constants/ai-task-registry.constants';

/** One metered call, as ally-ai reports it (an `llm_usage` SQS message with CR1's attribution). */
export interface MeteredCall {
  runId: string;
  kind: UsageKind;
  channel: UsageChannel;
  step?: number | null;
  seq?: number | null;
  chatbotId?: string | null;
  draftId?: string | null;
  creatorUserId?: number | null;
  conversationId?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  /** Non-token quantity, already in the price's unit (minutes, pages, 1M chars). */
  units?: number | null;
  unit?: string | null;
  /** Fixed price instead of a model's (a WhatsApp message): micros. */
  fixedCostMicros?: number | null;
  priceId?: string | null;
  occurredAt?: Date;
  detail?: Record<string, unknown> | null;
  /** Stage 6: the account stamped on the run when it started (echoed back by ally-ai). */
  payerAccountId?: string | null;
  /** Stage 6: the end person the run was for. */
  endPersonId?: string | null;
  /** Stage 6: the AI task registry id, or the raw `llm_usage.task` label when it has no row. */
  task?: string | null;
}

/**
 * Something that must change in the same transaction as a new usage event: the creator's token
 * balance (CR1 Part B). Runs only when the event was actually inserted, so a redelivery never
 * counts twice.
 */
export interface UsageEventListener {
  onUsageRecorded(manager: EntityManager, event: UsageEvent): Promise<void>;
}

export const USAGE_EVENT_UNPRICED = 'billing.usage.unpriced';

const VALID_KINDS = new Set<string>(Object.values(UsageKind));
const VALID_CHANNELS = new Set<string>(Object.values(UsageChannel));
const UUID = /^[0-9a-f-]{36}$/i;

interface CachedModel {
  model: BillingModel;
  prices: BillingModelPrice[];
}

/**
 * Records `usage_events` (CR1 Part A). Called from the `llm_usage` SQS processor and the WhatsApp
 * pricing webhook, never from a reply's path: by the time a call is recorded the reply has gone.
 *
 * Throws on a database failure, so the SQS message is redelivered; the unique key
 * (runId, kind, step, seq) makes that safe.
 */
@Injectable()
export class UsageEventService {
  private readonly logger = LoggerService.getInstance(UsageEventService.name);
  private readonly listeners: UsageEventListener[] = [];
  private catalogue: Map<string, CachedModel> | null = null;
  private catalogueAt = 0;
  private static readonly CATALOGUE_TTL_MS = 60_000;

  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  addListener(listener: UsageEventListener): void {
    this.listeners.push(listener);
  }

  /** Forget the cached models and prices (after an admin change). */
  invalidateCatalogue(): void {
    this.catalogue = null;
  }

  /** Is this SQS usage payload one of ours (an assistant's)? */
  static attributionOf(
    metadata: Record<string, unknown> | undefined | null,
  ): Pick<
    MeteredCall,
    | 'runId'
    | 'kind'
    | 'channel'
    | 'step'
    | 'seq'
    | 'chatbotId'
    | 'draftId'
    | 'creatorUserId'
    | 'conversationId'
    | 'payerAccountId'
    | 'endPersonId'
  > | null {
    if (!metadata) return null;
    const runId = str(metadata.run_id);
    const kind = str(metadata.kind);
    if (!runId || !kind || !VALID_KINDS.has(kind)) return null;
    const chatbotId = uuidOrNull(metadata.chatbot_id);
    const draftId = uuidOrNull(metadata.draft_id);
    const creator = Number(metadata.creator_user_id);
    if (!chatbotId && !draftId && !Number.isFinite(creator)) return null;
    const channel = str(metadata.channel);
    return {
      runId: runId.slice(0, 120),
      kind: kind as UsageKind,
      channel: (channel && VALID_CHANNELS.has(channel)
        ? channel
        : UsageChannel.OTHER) as UsageChannel,
      step: intOrNull(metadata.step),
      seq: intOrNull(metadata.seq),
      chatbotId,
      draftId,
      creatorUserId: Number.isFinite(creator) && creator > 0 ? creator : null,
      conversationId: str(metadata.conversation_id)?.slice(0, 120) ?? null,
      payerAccountId: uuidOrNull(metadata.payer_account_id),
      endPersonId: uuidOrNull(metadata.end_person_id),
    };
  }

  /** The AI task registry id for an `llm_usage.task` label (stage 6), else the label itself. */
  static taskIdFor(label: unknown): string | null {
    const text = str(label);
    if (!text) return null;
    const row = AI_TASK_REGISTRY.find((entry) => entry.task === text);
    return (row?.id ?? text).slice(0, 80);
  }

  /** Record one call. Returns the stored event, or null when it was already recorded. */
  async record(call: MeteredCall): Promise<UsageEvent | null> {
    const occurredAt = call.occurredAt ?? new Date();
    const provider = call.provider
      ? canonicalBillingProvider(call.provider)
      : null;
    const priced = await this.priceFor(
      provider,
      call.model ?? null,
      occurredAt,
    );

    let cost: number | null;
    if (call.fixedCostMicros !== undefined) {
      cost = call.fixedCostMicros;
    } else {
      cost = costMicros(
        {
          provider,
          inputTokens: call.inputTokens,
          cachedTokens: call.cachedTokens,
          outputTokens: call.outputTokens,
          units: call.units,
        },
        priced?.price ?? null,
      );
    }
    // Stage 6: an unpriced call is charged a pessimistic fallback, never nothing. `costMicros`
    // stays NULL so `reprice` still finds it; the ledger reads `chargedMicros`.
    const charged = cost ?? fallbackCostMicros(call);
    const task =
      call.task ?? UsageEventService.taskIdFor(call.detail?.task ?? null);

    return this.dataSource.transaction(async (manager) => {
      const owner = await this.ownerOf(manager, call);
      const rows: Array<Record<string, unknown>> = await manager.query(
        `INSERT INTO usage_events
           ("createdAt", "creatorUserId", "chatbotId", "draftId", "conversationId", "channel",
            "runId", "step", "seq", "kind", "provider", "modelName", "modelId", "priceId",
            "inputTokens", "cachedTokens", "outputTokens", "units", "unit", "costMicros", "detail",
            "payerAccountId", "endPersonId", "task", "chargedMicros")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT ("runId", "kind", "step", "seq") DO NOTHING
         RETURNING *`,
        [
          occurredAt,
          owner.creatorUserId,
          owner.chatbotId,
          call.draftId ?? null,
          call.conversationId ?? null,
          call.channel,
          call.runId,
          call.step ?? 0,
          call.seq ?? 0,
          call.kind,
          provider,
          call.model ?? null,
          priced?.model.id ?? null,
          call.priceId ?? priced?.price?.id ?? null,
          Math.max(0, Math.round(call.inputTokens ?? 0)),
          Math.max(0, Math.round(call.cachedTokens ?? 0)),
          Math.max(0, Math.round(call.outputTokens ?? 0)),
          call.units ?? null,
          call.unit ?? null,
          cost,
          call.detail ? JSON.stringify(call.detail) : null,
          call.payerAccountId ?? null,
          call.endPersonId ?? null,
          task,
          charged,
        ],
      );
      if (!rows.length) return null;
      const event = manager.create(UsageEvent, {
        ...rows[0],
        costMicros:
          rows[0].costMicros === null ? null : Number(rows[0].costMicros),
        chargedMicros:
          rows[0].chargedMicros === null || rows[0].chargedMicros === undefined
            ? null
            : Number(rows[0].chargedMicros),
      } as Partial<UsageEvent>);
      for (const listener of this.listeners) {
        await listener.onUsageRecorded(manager, event);
      }
      if (cost === null && call.model) {
        this.events?.emit(USAGE_EVENT_UNPRICED, {
          provider,
          model: call.model,
          at: occurredAt,
        });
      }
      return event;
    });
  }

  /**
   * Price usage that was recorded before its model or price existed. Called after a model or a
   * price version is added. Returns how many events got a cost.
   */
  async reprice(provider: string, model: string): Promise<number> {
    this.invalidateCatalogue();
    const canonical = canonicalBillingProvider(provider);
    const rows: UsageEvent[] = await this.dataSource
      .getRepository(UsageEvent)
      .createQueryBuilder('e')
      .where('e."costMicros" IS NULL')
      .andWhere('e."modelName" = :model', { model })
      .andWhere('(e.provider = :provider OR e.provider IS NULL)', {
        provider: canonical,
      })
      .limit(5000)
      .getMany();
    let priced = 0;
    for (const row of rows) {
      const found = await this.priceFor(canonical, model, row.createdAt);
      const cost = costMicros(
        {
          provider: canonical,
          inputTokens: row.inputTokens,
          cachedTokens: row.cachedTokens,
          outputTokens: row.outputTokens,
          units: row.units,
        },
        found?.price ?? null,
      );
      if (cost === null) continue;
      await this.dataSource.query(
        // Stage 6: the fallback charge is replaced in the ledger by the nightly rebuild.
        `UPDATE usage_events SET "costMicros" = $1, "chargedMicros" = $1, "modelId" = $2, "priceId" = $3
          WHERE id = $4 AND "costMicros" IS NULL`,
        [cost, found!.model.id, found!.price!.id, row.id],
      );
      priced += 1;
    }
    return priced;
  }

  /** The model and the price version in force at `at`, if the model is known. */
  async priceFor(
    provider: string | null,
    model: string | null,
    at: Date,
  ): Promise<{ model: BillingModel; price: BillingModelPrice | null } | null> {
    if (!model) return null;
    const catalogue = await this.loadCatalogue();
    const exact = provider ? catalogue.get(`${provider}/${model}`) : undefined;
    const found =
      exact ??
      // ally-ai sometimes reports a dated snapshot (`gpt-4o-mini-2024-07-18`) or no provider:
      // fall back to the longest catalogue id the reported one starts with.
      [...catalogue.values()]
        .filter(
          (entry) =>
            (!provider || entry.model.provider === provider) &&
            (model === entry.model.model ||
              model.startsWith(`${entry.model.model}-`)),
        )
        .sort((a, b) => b.model.model.length - a.model.model.length)[0];
    if (!found) return null;
    return { model: found.model, price: priceAt(found.prices, at) };
  }

  private async loadCatalogue(): Promise<Map<string, CachedModel>> {
    if (
      this.catalogue &&
      Date.now() - this.catalogueAt < UsageEventService.CATALOGUE_TTL_MS
    ) {
      return this.catalogue;
    }
    const models = await this.dataSource.getRepository(BillingModel).find();
    const prices = await this.dataSource
      .getRepository(BillingModelPrice)
      .find();
    const byModel = new Map<string, BillingModelPrice[]>();
    for (const price of prices) {
      const list = byModel.get(price.modelId) ?? [];
      list.push(price);
      byModel.set(price.modelId, list);
    }
    const map = new Map<string, CachedModel>();
    for (const model of models) {
      map.set(`${model.provider}/${model.model}`, {
        model,
        prices: byModel.get(model.id) ?? [],
      });
    }
    this.catalogue = map;
    this.catalogueAt = Date.now();
    return map;
  }

  /** Who pays: the assistant's creator (or the draft's, before it became an assistant). */
  private async ownerOf(
    manager: EntityManager,
    call: MeteredCall,
  ): Promise<{ creatorUserId: number | null; chatbotId: string | null }> {
    let chatbotId = call.chatbotId ?? null;
    let creator = call.creatorUserId ?? null;
    // Stage 3 (R4): a template's knowledge is indexed at Ally's cost. Never look a payer up for it,
    // so it is never charged to the chatbot's builder. Stage 9: nor is the pack release suite.
    if (ALLY_PAID_USAGE_KINDS.has(call.kind)) {
      return { creatorUserId: null, chatbotId };
    }
    try {
      if (chatbotId && creator === null) {
        const [row] = await manager.query(
          `SELECT created_by FROM chatbots WHERE id = $1`,
          [chatbotId],
        );
        creator = row?.created_by ?? null;
      }
      if (call.draftId && (creator === null || chatbotId === null)) {
        const [row] = await manager.query(
          `SELECT owner_user_id, chatbot_id FROM bot_drafts WHERE id = $1`,
          [call.draftId],
        );
        creator = creator ?? row?.owner_user_id ?? null;
        chatbotId = chatbotId ?? row?.chatbot_id ?? null;
      }
    } catch (error) {
      this.logger.warn(
        `Could not resolve who pays for run ${call.runId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    return { creatorUserId: creator, chatbotId };
  }
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const uuidOrNull = (value: unknown): string | null => {
  const text = str(value);
  return text && UUID.test(text) ? text.toLowerCase() : null;
};

const intOrNull = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
