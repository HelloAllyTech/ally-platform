import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { computeServiceCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { istMonthStart } from '../util/ist.util';

/**
 * What the agent has spent this IST calendar month: every `llm_usage` row labelled
 * `pm_agent` (or a finer `pm_agent_*` per-lane label), priced with the shared pricing
 * table. `llm_usage` stores quantities, not money, so pricing happens at read time,
 * exactly as the AI-usage analytics do. Unpriced models count as 0 and mark the figure
 * approximate.
 */
@Injectable()
export class PmAgentBudgetService {
  constructor(private readonly dataSource: DataSource) {}

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
          AND (task = $2::varchar OR task LIKE $3::varchar)
        GROUP BY service, provider, model, task`,
      [istMonthStart(now), LlmTask.PM_AGENT, `${LlmTask.PM_AGENT}\\_%`],
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
}
