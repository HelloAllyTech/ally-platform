import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BillingModel } from '../entity/billing-model.entity';
import { BillingModelPrice } from '../entity/billing-model-price.entity';
import { CostSettings } from '../entity/cost-settings.entity';
import { FixedCost } from '../entity/fixed-cost.entity';
import { WhatsAppRate } from '../entity/whatsapp-rate.entity';
import {
  BillingModelType,
  BillingStatus,
  PriceUnit,
  WhatsAppRateCategory,
} from '../enum/billing.enum';
import {
  canonicalBillingProvider,
  microsToUsd,
  priceAt,
  usdToMicros,
} from '../util/pricing.util';
import { BillingAuditService } from './billing-audit.service';
import { UsageEventService } from './usage-event.service';

export interface PriceInput {
  inputPerMillionUsd?: number | null;
  cachedInputPerMillionUsd?: number | null;
  outputPerMillionUsd?: number | null;
  unitPriceUsd?: number | null;
  unit?: PriceUnit | null;
  effectiveFrom?: string;
}

export interface ModelRow {
  id: string;
  provider: string;
  model: string;
  label: string;
  type: BillingModelType;
  status: BillingStatus;
  notes: string | null;
  current: BillingModelPrice | null;
  versions: number;
  usageCount: number;
  unpricedCount: number;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Ally admin → Models and the other things Ally sets prices for (CR1 Part A). Super admins only
 * (`manage_costs`, checked on the controller). Every change has a note and lands in billing_audit.
 *
 * A price change is a new version effective from a date; old usage keeps the price it was
 * recorded with. A model with usage can only be retired, never deleted.
 */
@Injectable()
export class BillingCatalogueService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: BillingAuditService,
    private readonly usage: UsageEventService,
  ) {}

  // ── models ──────────────────────────────────────────────────────────

  async listModels(): Promise<ModelRow[]> {
    const models = await this.dataSource.getRepository(BillingModel).find({
      order: { status: 'ASC', provider: 'ASC', label: 'ASC' },
    });
    const prices = await this.dataSource
      .getRepository(BillingModelPrice)
      .find();
    const counts: Array<{ modelId: string; used: string; unpriced: string }> =
      await this.dataSource.query(
        `SELECT m.id AS "modelId",
                count(e.id) FILTER (WHERE e."modelId" = m.id) AS used,
                0 AS unpriced
           FROM billing_models m
           LEFT JOIN usage_events e ON e."modelId" = m.id
          GROUP BY m.id`,
      );
    const unpriced: Array<{ provider: string; model: string; n: string }> =
      await this.dataSource.query(
        `SELECT provider, "modelName" AS model, count(*) AS n
           FROM usage_events WHERE "costMicros" IS NULL AND "modelName" IS NOT NULL
          GROUP BY provider, "modelName"`,
      );
    const usedBy = new Map(
      counts.map((row) => [row.modelId, Number(row.used)]),
    );
    const now = new Date();
    return models.map((model) => {
      const own = prices.filter((price) => price.modelId === model.id);
      return {
        id: model.id,
        provider: model.provider,
        model: model.model,
        label: model.label,
        type: model.type,
        status: model.status,
        notes: model.notes,
        current: priceAt(own, now),
        versions: own.length,
        usageCount: usedBy.get(model.id) ?? 0,
        unpricedCount: unpriced
          .filter(
            (row) =>
              row.model === model.model &&
              (!row.provider || row.provider === model.provider),
          )
          .reduce((sum, row) => sum + Number(row.n), 0),
      };
    });
  }

  /** Models usage reported that aren't in the list yet: the "unpriced" banner. */
  async unknownModels(): Promise<
    Array<{
      provider: string | null;
      model: string;
      events: number;
      since: Date;
    }>
  > {
    const rows: Array<{
      provider: string | null;
      model: string;
      n: string;
      since: Date;
    }> = await this.dataSource.query(
      `SELECT provider, "modelName" AS model, count(*) AS n, min("createdAt") AS since
           FROM usage_events
          WHERE "costMicros" IS NULL AND "modelName" IS NOT NULL AND "modelId" IS NULL
          GROUP BY provider, "modelName" ORDER BY n DESC`,
    );
    return rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      events: Number(row.n),
      since: row.since,
    }));
  }

  async priceHistory(modelId: string) {
    await this.modelOr404(modelId);
    const versions = await this.dataSource
      .getRepository(BillingModelPrice)
      .find({
        where: { modelId },
        order: { version: 'DESC' },
      });
    const history = await this.audit.historyOf('model', modelId);
    return { versions, history };
  }

  async addModel(
    input: {
      provider: string;
      model: string;
      label?: string;
      type: BillingModelType;
      notes?: string | null;
      price: PriceInput;
      note: string;
    },
    actor: number | null,
  ): Promise<ModelRow> {
    const note = BillingAuditService.requireNote(input.note);
    const provider = canonicalBillingProvider(input.provider);
    const model = String(input.model ?? '').trim();
    if (!provider || !model) {
      throw new BadRequestException('Provider and model id are required.');
    }
    if (!Object.values(BillingModelType).includes(input.type)) {
      throw new BadRequestException('Pick a type.');
    }
    const clash = await this.dataSource
      .getRepository(BillingModel)
      .findOne({ where: { provider, model } });
    if (clash) {
      throw new ConflictException(
        `${provider} ${model} is already in the list. Update its price instead.`,
      );
    }
    const price = validPrice(input.price);
    const saved = await this.dataSource.transaction(async (manager) => {
      const row = await manager.getRepository(BillingModel).save(
        manager.getRepository(BillingModel).create({
          provider,
          model,
          label: input.label?.trim() || model,
          type: input.type,
          status: BillingStatus.ACTIVE,
          notes: input.notes?.trim() || null,
          createdBy: actor,
        }),
      );
      const version = await manager.getRepository(BillingModelPrice).save(
        manager.getRepository(BillingModelPrice).create({
          ...price,
          modelId: row.id,
          version: 1,
          note,
          createdBy: actor,
        }),
      );
      await this.audit.record(
        {
          subjectType: 'model',
          subjectId: row.id,
          action: 'add',
          after: { ...row, price: version },
          note,
          actorUserId: actor,
        },
        manager,
      );
      return row;
    });
    this.usage.invalidateCatalogue();
    // Usage recorded before the model existed gets its cost now.
    await this.usage.reprice(provider, model);
    return this.rowOf(saved.id);
  }

  async updatePrice(
    modelId: string,
    input: PriceInput & { note: string },
    actor: number | null,
  ): Promise<ModelRow> {
    const note = BillingAuditService.requireNote(input.note);
    const model = await this.modelOr404(modelId);
    const price = validPrice(input);
    await this.dataSource.transaction(async (manager) => {
      const [{ max }] = await manager.query(
        `SELECT coalesce(max(version), 0) AS max FROM billing_model_prices WHERE "modelId" = $1`,
        [modelId],
      );
      const version = await manager.getRepository(BillingModelPrice).save(
        manager.getRepository(BillingModelPrice).create({
          ...price,
          modelId,
          version: Number(max) + 1,
          note,
          createdBy: actor,
        }),
      );
      await this.audit.record(
        {
          subjectType: 'model',
          subjectId: modelId,
          action: 'price',
          after: version,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    this.usage.invalidateCatalogue();
    await this.usage.reprice(model.provider, model.model);
    return this.rowOf(modelId);
  }

  async editModel(
    modelId: string,
    input: {
      label?: string;
      type?: BillingModelType;
      notes?: string | null;
      note: string;
    },
    actor: number | null,
  ): Promise<ModelRow> {
    const note = BillingAuditService.requireNote(input.note);
    const model = await this.modelOr404(modelId);
    const before = { ...model };
    if (input.label !== undefined)
      model.label = input.label.trim() || model.model;
    if (input.type !== undefined) {
      if (!Object.values(BillingModelType).includes(input.type)) {
        throw new BadRequestException('Pick a type.');
      }
      model.type = input.type;
    }
    if (input.notes !== undefined) model.notes = input.notes?.trim() || null;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(BillingModel).save(model);
      await this.audit.record(
        {
          subjectType: 'model',
          subjectId: modelId,
          action: 'edit',
          before,
          after: model,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    this.usage.invalidateCatalogue();
    return this.rowOf(modelId);
  }

  async setStatus(
    modelId: string,
    status: BillingStatus,
    noteInput: string,
    actor: number | null,
  ): Promise<ModelRow> {
    const note = BillingAuditService.requireNote(noteInput);
    const model = await this.modelOr404(modelId);
    if (!Object.values(BillingStatus).includes(status)) {
      throw new BadRequestException('Unknown status.');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(BillingModel).update(modelId, { status });
      await this.audit.record(
        {
          subjectType: 'model',
          subjectId: modelId,
          action: status === BillingStatus.RETIRED ? 'retire' : 'reactivate',
          before: { status: model.status },
          after: { status },
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    this.usage.invalidateCatalogue();
    return this.rowOf(modelId);
  }

  /** Only a mistake can be deleted: a model any usage was recorded against is retired instead. */
  async deleteModel(
    modelId: string,
    noteInput: string,
    actor: number | null,
  ): Promise<{ deleted: true }> {
    const note = BillingAuditService.requireNote(noteInput);
    const model = await this.modelOr404(modelId);
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*) AS n FROM usage_events WHERE "modelId" = $1`,
      [modelId],
    );
    if (Number(n) > 0) {
      throw new ConflictException(
        'Usage has been recorded against this model, so it can’t be deleted. Retire it instead.',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(BillingModel).delete(modelId);
      await this.audit.record(
        {
          subjectType: 'model',
          subjectId: modelId,
          action: 'delete',
          before: model,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    this.usage.invalidateCatalogue();
    return { deleted: true };
  }

  // ── WhatsApp rates ──────────────────────────────────────────────────

  async listWhatsAppRates() {
    const rows = await this.dataSource.getRepository(WhatsAppRate).find({
      order: { country: 'ASC', category: 'ASC', version: 'DESC' },
    });
    const now = new Date();
    const groups = new Map<string, WhatsAppRate[]>();
    for (const row of rows) {
      const key = `${row.country}/${row.category}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.values()].map((versions) => ({
      country: versions[0].country,
      category: versions[0].category,
      status: versions[0].status,
      current: priceAt(versions, now),
      versions,
    }));
  }

  async setWhatsAppRate(
    input: {
      country: string;
      category: WhatsAppRateCategory;
      priceUsd: number;
      effectiveFrom?: string;
      note: string;
    },
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(input.note);
    const country = String(input.country ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new BadRequestException('Use a two-letter country code, like IN.');
    }
    if (!Object.values(WhatsAppRateCategory).includes(input.category)) {
      throw new BadRequestException('Pick a category.');
    }
    const usd = Number(input.priceUsd);
    if (!Number.isFinite(usd) || usd < 0) {
      throw new BadRequestException('The rate must be zero or more.');
    }
    const effectiveFrom = validDate(input.effectiveFrom);
    await this.dataSource.transaction(async (manager) => {
      const [{ max }] = await manager.query(
        `SELECT coalesce(max(version), 0) AS max FROM whatsapp_rates WHERE country = $1 AND category = $2`,
        [country, input.category],
      );
      const row = await manager.getRepository(WhatsAppRate).save(
        manager.getRepository(WhatsAppRate).create({
          country,
          category: input.category,
          version: Number(max) + 1,
          priceMicros: usdToMicros(usd),
          effectiveFrom,
          status: BillingStatus.ACTIVE,
          note,
          createdBy: actor,
        }),
      );
      await this.audit.record(
        {
          subjectType: 'whatsapp_rate',
          subjectId: `${country}/${input.category}`,
          action: Number(max) ? 'price' : 'add',
          after: row,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    return this.listWhatsAppRates();
  }

  async retireWhatsAppRate(
    country: string,
    category: WhatsAppRateCategory,
    noteInput: string,
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(noteInput);
    const result = await this.dataSource
      .getRepository(WhatsAppRate)
      .update(
        { country: country.toUpperCase(), category },
        { status: BillingStatus.RETIRED },
      );
    if (!result.affected) throw new NotFoundException('No such rate.');
    await this.audit.record({
      subjectType: 'whatsapp_rate',
      subjectId: `${country.toUpperCase()}/${category}`,
      action: 'retire',
      note,
      actorUserId: actor,
    });
    return this.listWhatsAppRates();
  }

  /** The rate for one message: country and category at that time. */
  async whatsAppRateAt(
    country: string,
    category: string,
    at: Date,
  ): Promise<WhatsAppRate | null> {
    const versions = await this.dataSource.getRepository(WhatsAppRate).find({
      where: {
        country: country.toUpperCase(),
        category: category as WhatsAppRateCategory,
      },
    });
    return priceAt(versions, at);
  }

  // ── settings and fixed costs ────────────────────────────────────────

  /** The settings in dollars, as the Costs screen edits them. */
  async settingsUsd() {
    const row = await this.settings();
    return {
      dailyBudgetUsd: microsToUsd(row.dailyBudgetMicros),
      conversationAlertUsd: microsToUsd(row.conversationAlertMicros),
      spikeMultiplier: Number(row.spikeMultiplier),
      spikeMinUsd: microsToUsd(row.spikeMinMicros),
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  async settings(): Promise<CostSettings> {
    const row = await this.dataSource
      .getRepository(CostSettings)
      .findOne({ where: { id: 1 } });
    if (!row) throw new NotFoundException('Cost settings are missing.');
    return row;
  }

  async updateSettings(
    input: {
      dailyBudgetUsd?: number;
      conversationAlertUsd?: number;
      spikeMultiplier?: number;
      spikeMinUsd?: number;
      note: string;
    },
    actor: number | null,
  ): Promise<CostSettings> {
    const note = BillingAuditService.requireNote(input.note);
    const before = await this.settings();
    const after = { ...before };
    const money = (value: number | undefined, label: string) => {
      if (value === undefined) return undefined;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestException(`${label} must be zero or more.`);
      }
      return usdToMicros(n);
    };
    after.dailyBudgetMicros =
      money(input.dailyBudgetUsd, 'The daily budget') ??
      before.dailyBudgetMicros;
    after.conversationAlertMicros =
      money(input.conversationAlertUsd, 'The conversation alert') ??
      before.conversationAlertMicros;
    after.spikeMinMicros =
      money(input.spikeMinUsd, 'The spike minimum') ?? before.spikeMinMicros;
    if (input.spikeMultiplier !== undefined) {
      const n = Number(input.spikeMultiplier);
      if (!Number.isFinite(n) || n < 1) {
        throw new BadRequestException(
          'The spike multiplier must be 1 or more.',
        );
      }
      after.spikeMultiplier = n;
    }
    after.updatedBy = actor;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(CostSettings).save(after);
      await this.audit.record(
        {
          subjectType: 'cost_settings',
          subjectId: '1',
          action: 'edit',
          before,
          after,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    return this.settings();
  }

  async fixedCosts(month?: string): Promise<FixedCost[]> {
    const repo = this.dataSource.getRepository(FixedCost);
    return month
      ? repo.find({
          where: { month: monthStart(month) },
          order: { label: 'ASC' },
        })
      : repo.find({ order: { month: 'DESC', label: 'ASC' }, take: 500 });
  }

  async saveFixedCost(
    input: {
      id?: string;
      month: string;
      label: string;
      amountUsd: number;
      note: string;
    },
    actor: number | null,
  ): Promise<FixedCost> {
    const note = BillingAuditService.requireNote(input.note);
    const label = String(input.label ?? '').trim();
    if (!label) throw new BadRequestException('Name the cost.');
    const amount = Number(input.amountUsd);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('The amount must be zero or more.');
    }
    const repo = this.dataSource.getRepository(FixedCost);
    const before = input.id
      ? await repo.findOne({ where: { id: input.id } })
      : null;
    if (input.id && !before) throw new NotFoundException('No such cost.');
    const row = await repo.save(
      repo.create({
        ...(before ?? {}),
        month: monthStart(input.month),
        label,
        amountMicros: usdToMicros(amount),
        note,
        createdBy: before?.createdBy ?? actor,
      }),
    );
    await this.audit.record({
      subjectType: 'fixed_cost',
      subjectId: row.id,
      action: before ? 'edit' : 'add',
      before,
      after: row,
      note,
      actorUserId: actor,
    });
    return row;
  }

  async deleteFixedCost(id: string, noteInput: string, actor: number | null) {
    const note = BillingAuditService.requireNote(noteInput);
    const repo = this.dataSource.getRepository(FixedCost);
    const before = await repo.findOne({ where: { id } });
    if (!before) throw new NotFoundException('No such cost.');
    await repo.delete(id);
    await this.audit.record({
      subjectType: 'fixed_cost',
      subjectId: id,
      action: 'delete',
      before,
      note,
      actorUserId: actor,
    });
    return { deleted: true as const };
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private async modelOr404(id: string): Promise<BillingModel> {
    const model = await this.dataSource
      .getRepository(BillingModel)
      .findOne({ where: { id } });
    if (!model) throw new NotFoundException('Model not found.');
    return model;
  }

  private async rowOf(id: string): Promise<ModelRow> {
    const rows = await this.listModels();
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new NotFoundException('Model not found.');
    return row;
  }
}

function validPrice(input: PriceInput) {
  const money = (value: number | null | undefined, label: string) => {
    if (value === null || value === undefined || (value as unknown) === '') {
      return null;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException(`${label} must be zero or more.`);
    }
    return usdToMicros(n);
  };
  const price = {
    inputPer1MMicros: money(input.inputPerMillionUsd, 'The input price'),
    cachedInputPer1MMicros: money(
      input.cachedInputPerMillionUsd,
      'The cached input price',
    ),
    outputPer1MMicros: money(input.outputPerMillionUsd, 'The output price'),
    unitPriceMicros: money(input.unitPriceUsd, 'The unit price'),
    unit: input.unit ?? null,
    effectiveFrom: validDate(input.effectiveFrom),
  };
  if (
    price.unit &&
    !Object.values(PriceUnit).includes(price.unit as PriceUnit)
  ) {
    throw new BadRequestException('Pick a unit.');
  }
  if (price.unitPriceMicros !== null && !price.unit) {
    throw new BadRequestException('Say what the unit price is per.');
  }
  if (
    price.inputPer1MMicros === null &&
    price.outputPer1MMicros === null &&
    price.unitPriceMicros === null
  ) {
    throw new BadRequestException('Give at least one price.');
  }
  return price;
}

function validDate(value?: string): string {
  if (!value) return today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException('Use a date like 2026-12-01.');
  }
  return value;
}

function monthStart(value: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(String(value ?? ''));
  if (!match) throw new BadRequestException('Use a month like 2026-11.');
  return `${match[1]}-${match[2]}-01`;
}
