import { Injectable } from '@nestjs/common';
import { In, LessThanOrEqual } from 'typeorm';
import { PmAgentOutcome } from '../entity/pm-agent-outcome.entity';
import { PmAgentOutcomeRepository } from '../repository/pm-agent.repositories';
import { PmMetricRef } from './metric-catalog';
import { PmImpactRowStatus } from './impact-verdict';

/** One impact row (kind = 'impact'), as the impact service sees it. */
export interface PmImpactRow {
  id: string;
  cardId: string;
  day: number;
  metricRef: PmMetricRef | null;
  windowFrom: string | null;
  windowTo: string | null;
  dueAt: Date | null;
  readAt: Date | null;
  value: number | null;
  baseline: number | null;
  sampleSize: number | null;
  status: PmImpactRowStatus;
  verdict: 'improved' | 'flat' | 'worse' | null;
  attempts: number;
  lastError: string | null;
}

export type PmImpactRowInsert = Omit<
  PmImpactRow,
  | 'id'
  | 'readAt'
  | 'value'
  | 'baseline'
  | 'sampleSize'
  | 'verdict'
  | 'lastError'
>;

export type PmImpactRowPatch = Partial<
  Pick<
    PmImpactRow,
    | 'readAt'
    | 'value'
    | 'baseline'
    | 'sampleSize'
    | 'status'
    | 'verdict'
    | 'attempts'
    | 'lastError'
  >
>;

/** The persistence port of PmAgentImpactService (an in-memory fake implements it in tests). */
export interface PmImpactStorePort {
  /** Insert rows that do not exist yet (ON CONFLICT (cardId, kind, day) DO NOTHING); returns the days inserted. */
  insertMissing(rows: PmImpactRowInsert[]): Promise<number[]>;
  rowsForCards(cardIds: string[]): Promise<PmImpactRow[]>;
  /** Pending rows due by `now`, oldest due first, baselines before checks. */
  listDue(now: Date, limit: number): Promise<PmImpactRow[]>;
  /** Conditional update: only while the row is still `pending` (a second worker loses). */
  updatePending(id: string, patch: PmImpactRowPatch): Promise<boolean>;
  /** Mirror a value onto the decision row's legacy columns (baselineValue / value14d / value30d). */
  mirrorOnDecision(
    cardId: string,
    patch: {
      baselineValue?: number | null;
      value14d?: number | null;
      value30d?: number | null;
    },
  ): Promise<void>;
  /** +14 d checks: how many are measured, and how many of those improved. */
  measuredCounts(): Promise<{ measured: number; improved: number }>;
}

const toRow = (row: PmAgentOutcome): PmImpactRow => ({
  id: row.id,
  cardId: row.cardId,
  day: Number(row.day),
  metricRef: (row.metricRef as PmMetricRef | null) ?? null,
  windowFrom: row.windowFrom ?? null,
  windowTo: row.windowTo ?? null,
  dueAt: row.dueAt ?? null,
  readAt: row.readAt ?? null,
  value: row.value ?? null,
  baseline: row.baseline ?? null,
  sampleSize: row.sampleSize ?? null,
  status: (row.status ?? 'pending') as PmImpactRowStatus,
  verdict: (row.verdict as PmImpactRow['verdict']) ?? null,
  attempts: Number(row.attempts ?? 0),
  lastError: row.lastError ?? null,
});

@Injectable()
export class PmImpactStore implements PmImpactStorePort {
  constructor(private readonly outcomes: PmAgentOutcomeRepository) {}

  async insertMissing(rows: PmImpactRowInsert[]): Promise<number[]> {
    if (!rows.length) return [];
    const result = await this.outcomes
      .createQueryBuilder()
      .insert()
      .into(PmAgentOutcome)
      .values(
        rows.map((row) => ({
          cardId: row.cardId,
          kind: 'impact' as const,
          day: row.day,
          metricRef: row.metricRef as Record<string, any> | null,
          windowFrom: row.windowFrom,
          windowTo: row.windowTo,
          dueAt: row.dueAt,
          status: row.status,
          attempts: row.attempts,
        })),
      )
      .orIgnore()
      .returning(['day'])
      .execute();
    return ((result.raw as { day: number }[]) ?? []).map((r) => Number(r.day));
  }

  async rowsForCards(cardIds: string[]): Promise<PmImpactRow[]> {
    if (!cardIds.length) return [];
    const rows = await this.outcomes.find({
      where: { cardId: In(cardIds), kind: 'impact' },
      order: { day: 'ASC' },
    });
    return rows.map(toRow);
  }

  async listDue(now: Date, limit: number): Promise<PmImpactRow[]> {
    const rows = await this.outcomes.find({
      where: { kind: 'impact', status: 'pending', dueAt: LessThanOrEqual(now) },
      order: { day: 'ASC', dueAt: 'ASC' },
      take: limit,
    });
    return rows.map(toRow);
  }

  async updatePending(id: string, patch: PmImpactRowPatch): Promise<boolean> {
    const result = await this.outcomes.update(
      { id, kind: 'impact', status: 'pending' },
      patch as Partial<PmAgentOutcome>,
    );
    return (result.affected ?? 0) > 0;
  }

  async mirrorOnDecision(
    cardId: string,
    patch: {
      baselineValue?: number | null;
      value14d?: number | null;
      value30d?: number | null;
    },
  ): Promise<void> {
    await this.outcomes.update({ cardId, kind: 'decision' }, patch);
  }

  async measuredCounts(): Promise<{ measured: number; improved: number }> {
    const rows: { measured: string; improved: string }[] =
      await this.outcomes.query(
        `SELECT COUNT(*) AS measured,
                COUNT(*) FILTER (WHERE verdict = 'improved') AS improved
           FROM pm_agent_outcomes
          WHERE kind = 'impact' AND day = 14 AND status = 'measured'`,
      );
    return {
      measured: Number(rows?.[0]?.measured ?? 0),
      improved: Number(rows?.[0]?.improved ?? 0),
    };
  }
}
