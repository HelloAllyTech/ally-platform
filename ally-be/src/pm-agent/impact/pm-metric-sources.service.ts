import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { computeServiceCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { CoachingLoopAnalyticsService } from 'src/analytics/service/coaching-loop-analytics.service';
import { CompletionRateAnalyticsService } from 'src/analytics/service/completion-rate-analytics.service';
import { PlatformAnalyticsService } from 'src/analytics/service/platform-analytics.service';
import { QualityDistributionAnalyticsService } from 'src/analytics/service/quality-distribution-analytics.service';
import { ScribeAdoptionAnalyticsService } from 'src/analytics/service/scribe-adoption-analytics.service';
import { PmMetricSources, PmMetricWindow } from './metric-catalog';

/**
 * The real sources behind the measurable-metric catalog: the AnalyticsModule's exported
 * read services (the same instances the lanes use) called with an explicit `from`/`to`
 * window and NO tenantId (platform-wide), plus one bounded `llm_usage` aggregate priced
 * with the shared pricing table. Read-only; writes nothing.
 */
@Injectable()
export class PmMetricSourcesService implements PmMetricSources {
  constructor(
    private readonly dataSource: DataSource,
    private readonly platformAnalytics: PlatformAnalyticsService,
    private readonly completionRateService: CompletionRateAnalyticsService,
    private readonly qualityDistributionService: QualityDistributionAnalyticsService,
    private readonly coachingLoopService: CoachingLoopAnalyticsService,
    private readonly scribeAdoptionService: ScribeAdoptionAnalyticsService,
  ) {}

  overview(q: { from: string; to: string }) {
    return this.platformAnalytics.getOverview({ ...q } as never);
  }

  completionRate(q: { from: string; to: string }) {
    return this.completionRateService.getCompletionRate({ ...q } as never);
  }

  qualityDistribution(q: { from: string; to: string }) {
    return this.qualityDistributionService.getQualityDistribution({
      ...q,
    } as never);
  }

  coachingLoop(q: { from: string; to: string }) {
    return this.coachingLoopService.getCoachingLoop({ ...q } as never);
  }

  scribeAdoption(q: { from: string; to: string }) {
    return this.scribeAdoptionService.getScribeAdoption({ ...q } as never);
  }

  voiceLatency(q: { from: string; to: string }) {
    return this.platformAnalytics.getVoiceLatency({ ...q } as never);
  }

  /** Window days are inclusive UTC dates; `occurredAt` is a tz-naive UTC timestamp. */
  async llmUsage(
    window: PmMetricWindow,
    task?: string,
  ): Promise<{ costUsd: number; calls: number }> {
    const rows: Record<string, string>[] = await this.dataSource.query(
      `SELECT service, provider, model, task, COUNT(*) AS calls,
              COALESCE(SUM("promptTokens"), 0) AS prompt,
              COALESCE(SUM("completionTokens"), 0) AS completion,
              COALESCE(SUM("totalTokens"), 0) AS total,
              COALESCE(SUM("cachedTokens"), 0) AS cached,
              COALESCE(SUM("audioMs"), 0) AS audio,
              COALESCE(SUM(characters), 0) AS chars
         FROM llm_usage
        WHERE "occurredAt" >= $1::date
          AND "occurredAt" < ($2::date + 1)
          AND ($3::varchar IS NULL OR task = $3::varchar)
        GROUP BY service, provider, model, task`,
      [window.from, window.to, task ?? null],
    );
    let costUsd = 0;
    let calls = 0;
    for (const row of rows) {
      const priced = computeServiceCostUsd(
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
      costUsd += priced.costUsd;
      calls += Number(row.calls);
    }
    return { costUsd, calls };
  }
}
