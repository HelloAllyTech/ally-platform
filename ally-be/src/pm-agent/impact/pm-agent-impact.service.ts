import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { PmCardKind } from '../enum/pm-agent.enum';
import { PmAgentEventsService } from '../service/pm-agent-events.service';
import {
  metricDefinition,
  metricRefProblems,
  PmMetricRef,
  PmMetricSources,
  PmMetricUnit,
  readMetric,
} from './metric-catalog';
import {
  impactSchedule,
  impactSummary,
  impactVerdict,
  PM_IMPACT,
  PmImpactRowStatus,
  PmImpactVerdict,
} from './impact-verdict';
import {
  PmImpactRow,
  PmImpactRowPatch,
  PmImpactStorePort,
} from './pm-impact.store';

/** DI tokens, so the service is unit-testable with fakes. */
export const PM_IMPACT_STORE = Symbol('PM_IMPACT_STORE');
export const PM_METRIC_SOURCES = Symbol('PM_METRIC_SOURCES');

/** `Card.delivery.impact` (docs/pm-agent.md, contract addendum v1.1). */
export interface PmImpactCheckView {
  day: 14 | 30;
  status: 'pending' | 'measured' | 'insufficient_data' | 'unavailable';
  value?: number;
  readAt?: string;
  dueAt: string;
  verdict?: PmImpactVerdict;
}

export interface PmImpactView {
  metricName: string;
  direction: 'up' | 'down';
  unit?: PmMetricUnit;
  baseline?: number;
  checks: PmImpactCheckView[];
  summary?: string;
}

type ImpactCard = { id: string; kind: string; payload: Record<string, any> };

const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

const API_STATUS: Record<PmImpactRowStatus, PmImpactCheckView['status']> = {
  pending: 'pending',
  measured: 'measured',
  insufficient_data: 'insufficient_data',
  unavailable: 'unavailable',
  not_measurable: 'unavailable',
};

/**
 * Impact checks (+14 / +30 days). Deterministic and metered by nothing but the analytics
 * reads: no model call anywhere here.
 *
 *  - `onReleased` (reconcile, when a card first becomes `released`): writes the baseline row
 *    (day 0, the 14 days before release) and the two check rows (+14, +30), idempotently
 *    (UNIQUE (cardId, kind, day), insert-if-missing), then tries the baseline read at once.
 *  - `runDue` (PmAgentImpactScheduler, daily): every pending row whose time has come —
 *    baselines first, then checks against them. A failed read stays `pending` and is retried
 *    on the next daily tick; the third failure is terminal `unavailable`.
 *  - `views` / `healthFigures`: the read side for the presenter and GET /health.
 *
 * Nothing here throws into its caller: release reconcile and the scheduler must not fail
 * because an analytics query did.
 */
@Injectable()
export class PmAgentImpactService {
  private readonly logger = LoggerService.getInstance(
    PmAgentImpactService.name,
  );

  constructor(
    @Inject(PM_IMPACT_STORE) private readonly store: PmImpactStorePort,
    @Inject(PM_METRIC_SOURCES) private readonly sources: PmMetricSources,
    private readonly events: PmAgentEventsService,
  ) {}

  // ── write side ───────────────────────────────────────────────────────────

  async onReleased(
    card: ImpactCard,
    releasedAt: Date,
    now: Date = new Date(),
  ): Promise<void> {
    try {
      if (card.kind !== PmCardKind.RECOMMENDATION) return;
      const ref = card.payload?.metricRef as PmMetricRef | undefined;
      if (!ref) return; // "impact not measurable": no rows at all
      const status: PmImpactRowStatus = metricRefProblems(ref).length
        ? 'not_measurable'
        : 'pending';
      const inserted = await this.store.insertMissing(
        impactSchedule(releasedAt).map((slot) => ({
          cardId: card.id,
          day: slot.day,
          metricRef: ref,
          windowFrom: slot.window.from,
          windowTo: slot.window.to,
          dueAt: slot.dueAt,
          status,
          attempts: 0,
        })),
      );
      if (!inserted.length) return; // a second call: the rows exist, the daily job owns them
      if (status === 'pending' && inserted.includes(0)) {
        await this.processCards([card.id], now, (row) => row.day === 0);
      }
      this.events.cardUpdated(card.id);
    } catch (error) {
      this.logger.warn(
        `[PM_AGENT] Impact setup for card ${card.id} failed: ${message(error)}`,
      );
    }
  }

  /** The daily job: every due pending row. Returns how many rows were settled or retried. */
  async runDue(
    now: Date = new Date(),
    limit: number = PM_IMPACT.BATCH,
  ): Promise<number> {
    let due: PmImpactRow[];
    try {
      due = await this.store.listDue(now, limit);
    } catch (error) {
      this.logger.warn(`[PM_AGENT] Impact due scan failed: ${message(error)}`);
      return 0;
    }
    if (!due.length) return 0;
    const dueIds = new Set(due.map((row) => row.id));
    const cardIds = [...new Set(due.map((row) => row.cardId))];
    const touched = await this.processCards(cardIds, now, (row) =>
      dueIds.has(row.id),
    );
    return touched;
  }

  /**
   * Process the selected pending rows of these cards, baseline first so a check in the same
   * pass sees the fresh baseline. Each row is independent: one failure never stops the rest.
   */
  private async processCards(
    cardIds: string[],
    now: Date,
    select: (row: PmImpactRow) => boolean,
  ): Promise<number> {
    const rows = await this.store.rowsForCards(cardIds);
    let processed = 0;
    for (const cardId of cardIds) {
      const mine = rows
        .filter((row) => row.cardId === cardId)
        .sort((a, b) => a.day - b.day);
      let changed = false;
      for (const row of mine) {
        if (row.status !== 'pending' || !select(row)) continue;
        if (row.dueAt && new Date(row.dueAt) > now) continue;
        try {
          const patch = await this.readRow(row, mine, now);
          if (!patch) continue; // waiting on the baseline
          if (await this.store.updatePending(row.id, patch)) {
            Object.assign(row, patch);
            processed += 1;
            changed = true;
            await this.mirror(row).catch(() => undefined);
          }
        } catch (error) {
          this.logger.warn(
            `[PM_AGENT] Impact read ${row.cardId}/+${row.day} failed: ${message(error)}`,
          );
        }
      }
      if (changed) this.events.cardUpdated(cardId);
    }
    return processed;
  }

  /** What one read changes on its row (null = not yet: the baseline is still pending). */
  private async readRow(
    row: PmImpactRow,
    siblings: PmImpactRow[],
    now: Date,
  ): Promise<PmImpactRowPatch | null> {
    const definition = metricDefinition(row.metricRef?.source);
    if (!definition || !row.metricRef || !row.windowFrom || !row.windowTo) {
      return {
        status: 'not_measurable',
        lastError: 'metric source is not in the catalog',
      };
    }
    let baseline: PmImpactRow | undefined;
    if (row.day > 0) {
      baseline = siblings.find((sibling) => sibling.day === 0);
      if (!baseline || baseline.status === 'pending') return null;
      if (
        baseline.status === 'unavailable' ||
        baseline.status === 'not_measurable'
      ) {
        return {
          status: baseline.status,
          lastError: 'the pre-release baseline could not be read',
        };
      }
    }

    const read = await readMetric(
      row.metricRef,
      { from: String(row.windowFrom), to: String(row.windowTo) },
      this.sources,
    );
    if (read.status === 'unavailable') {
      const attempts = row.attempts + 1;
      return {
        attempts,
        lastError: read.error,
        ...(attempts >= PM_IMPACT.MAX_ATTEMPTS
          ? { status: 'unavailable' as const, readAt: now }
          : {}),
      };
    }

    if (row.day === 0) {
      return {
        readAt: now,
        value: read.value,
        sampleSize: read.sampleSize,
        lastError: null,
        status:
          read.value != null && read.sampleSize >= definition.minSample
            ? 'measured'
            : 'insufficient_data',
      };
    }
    const verdict = impactVerdict({
      baseline: baseline!.value,
      baselineSample: baseline!.sampleSize,
      value: read.value,
      sample: read.sampleSize,
      minSample: definition.minSample,
      betterWhen: row.metricRef.betterWhen === 'down' ? 'down' : 'up',
    });
    return {
      readAt: now,
      value: read.value,
      sampleSize: read.sampleSize,
      baseline: baseline!.value,
      lastError: null,
      status: verdict.status,
      verdict: verdict.status === 'measured' ? verdict.verdict : null,
    };
  }

  /** Keep the decision row's legacy read-out columns in step (learning reads the rows). */
  private async mirror(row: PmImpactRow): Promise<void> {
    if (row.value == null) return;
    const key =
      row.day === 0
        ? 'baselineValue'
        : row.day === 14
          ? 'value14d'
          : 'value30d';
    await this.store.mirrorOnDecision(row.cardId, { [key]: row.value });
  }

  // ── read side ────────────────────────────────────────────────────────────

  /** `delivery.impact` per card id (only cards with a metricRef appear). */
  async views(cards: ImpactCard[]): Promise<Map<string, PmImpactView>> {
    const out = new Map<string, PmImpactView>();
    const measurable = cards.filter(
      (card) =>
        card.kind === PmCardKind.RECOMMENDATION && card.payload?.metricRef,
    );
    if (!measurable.length) return out;
    let rows: PmImpactRow[] = [];
    try {
      rows = await this.store.rowsForCards(measurable.map((card) => card.id));
    } catch (error) {
      this.logger.warn(`[PM_AGENT] Impact rows unreadable: ${message(error)}`);
    }
    for (const card of measurable) {
      out.set(
        card.id,
        PmAgentImpactService.view(
          card,
          rows.filter((row) => row.cardId === card.id),
        ),
      );
    }
    return out;
  }

  static view(card: ImpactCard, rows: PmImpactRow[]): PmImpactView {
    const ref = card.payload.metricRef as PmMetricRef;
    const definition = metricDefinition(ref?.source);
    const metricName =
      String(card.payload?.impactMetric?.name ?? '').trim() ||
      definition?.label ||
      String(ref?.source ?? 'Impact');
    const unit = definition?.unit ?? ref?.unit;
    const base = rows.find((row) => row.day === 0);
    const baseline =
      base &&
      (base.status === 'measured' || base.status === 'insufficient_data') &&
      base.value != null
        ? base.value
        : undefined;
    const checks: PmImpactCheckView[] = rows
      .filter((row) => row.day === 14 || row.day === 30)
      .sort((a, b) => a.day - b.day)
      .map((row) => ({
        day: row.day as 14 | 30,
        status: API_STATUS[row.status] ?? 'unavailable',
        ...(row.value != null ? { value: row.value } : {}),
        ...(row.readAt ? { readAt: new Date(row.readAt).toISOString() } : {}),
        dueAt: new Date(row.dueAt ?? 0).toISOString(),
        ...(row.status === 'measured' && row.verdict
          ? { verdict: row.verdict }
          : {}),
      }));
    const summary = impactSummary({ metricName, unit, baseline, checks });
    return {
      metricName,
      direction: ref?.betterWhen === 'down' ? 'down' : 'up',
      ...(unit ? { unit } : {}),
      ...(baseline != null ? { baseline } : {}),
      checks,
      ...(summary ? { summary } : {}),
    };
  }

  /** GET /health additions: measured +14 d checks, and the share that improved. */
  async healthFigures(): Promise<{
    impactMeasuredCount: number;
    impactImprovedRate: number | null;
  }> {
    try {
      const { measured, improved } = await this.store.measuredCounts();
      return {
        impactMeasuredCount: measured,
        impactImprovedRate: measured
          ? Math.round((improved / measured) * 1000) / 1000
          : null,
      };
    } catch {
      return { impactMeasuredCount: 0, impactImprovedRate: null };
    }
  }
}
