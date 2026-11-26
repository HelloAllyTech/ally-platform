import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { computeServiceCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import {
  MANUAL_RUN_CAP_DIVISOR,
  MANUAL_TASK_PREFIX,
} from '../constants/manual.constants';
import type { ManualBudgetSnapshot } from '../type/manual.types';
import { istMonthStart } from '../util/manual-time.util';
import { ManualSettingsService } from './manual-settings.service';

/**
 * What the manual has spent this IST calendar month, and what a run may reserve. Spend is every priced
 * `llm_usage` row labelled `product_manual_*` (the chat agent and the weekly agent share one cap);
 * `llm_usage` stores quantities, so pricing happens at read time with the shared table, exactly as
 * `PmAgentBudgetService` does. Unpriced models count as 0 and mark the figure approximate.
 */
@Injectable()
export class ManualBudgetService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: ManualSettingsService,
  ) {}

  async spentThisMonthUsd(
    now: Date = new Date(),
  ): Promise<{ spentUsd: number; approximate: boolean }> {
    const rows: {
      service: string;
      provider: string;
      model: string;
      task: string;
      prompt: string;
      completion: string;
      total: string;
      cached: string;
      audio: string;
      chars: string;
    }[] = await this.dataSource.query(
      `SELECT service, provider, model, task,
              COALESCE(SUM("promptTokens"), 0) AS prompt,
              COALESCE(SUM("completionTokens"), 0) AS completion,
              COALESCE(SUM("totalTokens"), 0) AS total,
              COALESCE(SUM("cachedTokens"), 0) AS cached,
              COALESCE(SUM("audioMs"), 0) AS audio,
              COALESCE(SUM(characters), 0) AS chars
         FROM llm_usage
        WHERE "occurredAt" >= $1::timestamp
          AND task LIKE $2::varchar
        GROUP BY service, provider, model, task`,
      [istMonthStart(now), `${MANUAL_TASK_PREFIX.replace(/_/g, '\\_')}%`],
    );
    let spentUsd = 0;
    let approximate = false;
    for (const row of rows) {
      const { costUsd, priced } = computeServiceCostUsd(
        (row.service || 'llm') as never,
        row.provider,
        row.model,
        {
          promptTokens: Number(row.prompt),
          completionTokens: Number(row.completion),
          totalTokens: Number(row.total),
          cachedTokens: Number(row.cached),
          audioMs: Number(row.audio),
          characters: Number(row.chars),
        },
        row.task,
      );
      spentUsd += costUsd;
      if (!priced) approximate = true;
    }
    return { spentUsd: Number(spentUsd.toFixed(4)), approximate };
  }

  /** Open reservations of running runs: what they reserved and have not yet recorded as spent. */
  async reservedUsd(): Promise<number> {
    const rows: { reserved: string | null }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM(GREATEST(reserved_usd - spent_usd, 0)), 0) AS reserved
         FROM manual_runs WHERE status = 'running'`,
    );
    return Number(Number(rows?.[0]?.reserved ?? 0).toFixed(4));
  }

  async snapshot(now: Date = new Date()): Promise<ManualBudgetSnapshot> {
    const [{ monthlyBudgetUsd }, spent, reservedUsd] = await Promise.all([
      this.settings.get(),
      this.spentThisMonthUsd(now),
      this.reservedUsd(),
    ]);
    return {
      monthlyBudgetUsd,
      spentUsd: spent.spentUsd,
      reservedUsd,
      exhausted: monthlyBudgetUsd - spent.spentUsd - reservedUsd <= 0,
      approximate: spent.approximate,
    };
  }

  /**
   * The most one run may reserve: what is left of the month, never more than a quarter of the monthly
   * budget, never below zero.
   */
  runCapUsd(
    snapshot: Pick<
      ManualBudgetSnapshot,
      'monthlyBudgetUsd' | 'spentUsd' | 'reservedUsd'
    >,
  ): number {
    const remaining =
      snapshot.monthlyBudgetUsd - snapshot.spentUsd - snapshot.reservedUsd;
    const cap = Math.min(
      remaining,
      snapshot.monthlyBudgetUsd / MANUAL_RUN_CAP_DIVISOR,
    );
    return Number(Math.max(0, cap).toFixed(4));
  }
}
