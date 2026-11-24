import { ForbiddenException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import {
  INSIGHT_CACHE_SECONDS,
  INSIGHT_LIMITS,
  INSIGHT_RULES,
  INSIGHT_SNOOZE_DAYS,
  InsightRule,
} from '../constants/tenant-insight-rules.constants';
import {
  TenantInsightDto,
  TenantInsightsResponseDto,
} from '../dto/tenant-insights.dto';
import {
  InsightState,
  TenantInsightStateRepository,
} from '../repository/tenant-insight-state.repository';
import { TenantChartLibraryService } from './tenant-chart-library.service';

/**
 * The ISO week a date is in, as `2026-W48`. A finding's fingerprint carries it,
 * so a finding that is still true next week is a new one and comes back even if
 * this week's was marked done.
 */
export const isoWeekKey = (date: Date): string => {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // The week belongs to the year of its Thursday.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

/**
 * Turns an organisation's charts into a short list of things worth a person's
 * attention today, and things worth celebrating.
 *
 * Each chart is read once, however many rules read it, by the same service that
 * draws the chart, so an insight can never disagree with the page it links to
 * and a chart the organisation cannot fill simply gives no findings. What was
 * found is the same for every admin of the organisation and is kept for a few
 * minutes; what each person has put away is theirs and is applied last.
 */
@Injectable()
export class TenantInsightsService {
  private readonly logger = LoggerService.getInstance(
    TenantInsightsService.name,
  );

  constructor(
    private readonly charts: TenantChartLibraryService,
    private readonly stateRepo: TenantInsightStateRepository,
    private readonly redis: RedisService,
  ) {}

  async getInsights(
    tenantId: string,
    userId: number,
    now = new Date(),
  ): Promise<TenantInsightsResponseDto> {
    await this.assertEnabled(tenantId);
    const found = await this.findings(tenantId, now);
    const hidden = await this.stateRepo.hiddenFingerprints(
      userId,
      found.map((f) => f.fingerprint),
    );
    const shown = found.filter((f) => !hidden.has(f.fingerprint));
    return {
      attention: shown
        .filter((f) => f.polarity === 'attention')
        .slice(0, INSIGHT_LIMITS.attention),
      celebrate: shown
        .filter((f) => f.polarity === 'celebrate')
        .slice(0, INSIGHT_LIMITS.celebrate),
    };
  }

  /** Marks a finding done, or snoozes it, for this person. */
  async setState(
    tenantId: string,
    userId: number,
    fingerprint: string,
    state: InsightState,
    days = INSIGHT_SNOOZE_DAYS,
  ): Promise<void> {
    await this.assertEnabled(tenantId);
    await this.stateRepo.put(tenantId, userId, fingerprint, state, days);
  }

  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.charts.isEnabled(tenantId))) {
      throw new ForbiddenException('Statistics page is not enabled');
    }
  }

  /** Every finding for the organisation, strongest first within each kind. */
  private async findings(
    tenantId: string,
    now: Date,
  ): Promise<TenantInsightDto[]> {
    const week = isoWeekKey(now);
    const cacheKey = `statistics:insights:${tenantId}:${week}`;
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    const data = await this.readCharts(tenantId);
    const out: TenantInsightDto[] = [];
    for (const rule of INSIGHT_RULES) {
      const chartData = data.get(this.chartKey(rule));
      if (chartData === undefined) continue;
      try {
        const draft = rule.evaluate(chartData);
        if (!draft) continue;
        out.push({
          fingerprint: [rule.id, draft.subjectKey, week]
            .filter(Boolean)
            .join(':'),
          ruleId: rule.id,
          polarity: rule.polarity,
          severity: Math.round(draft.severity * 100) / 100,
          params: draft.params,
          chartId: draft.evidence.chartId,
          view: draft.evidence.view,
          ...(draft.evidence.filters
            ? { filters: draft.evidence.filters as Record<string, string> }
            : {}),
        });
      } catch (error) {
        // One rule failing must not take the rest down.
        this.logger.warn(`Insight rule ${rule.id} failed: ${error}`);
      }
    }
    out.sort(
      (a, b) => b.severity - a.severity || a.ruleId.localeCompare(b.ruleId),
    );
    await this.writeCache(cacheKey, out);
    return out;
  }

  private chartKey(rule: InsightRule): string {
    return `${rule.chartId}|${rule.range ?? ''}`;
  }

  /** Reads each chart the rules need, once. A chart the organisation cannot fill gives nothing. */
  private async readCharts(tenantId: string): Promise<Map<string, unknown>> {
    const wanted = new Map<string, InsightRule>();
    INSIGHT_RULES.forEach((rule) => wanted.set(this.chartKey(rule), rule));
    const results = await Promise.all(
      [...wanted.entries()].map(async ([key, rule]) => {
        try {
          const response = await this.charts.getChartData(
            tenantId,
            rule.chartId,
            rule.range ? { range: rule.range } : {},
          );
          return [key, response.data] as const;
        } catch (error) {
          // Not enough data for the chart (a Forbidden) is the usual reason: say nothing.
          if (!(error instanceof ForbiddenException)) {
            this.logger.warn(`Insight chart ${rule.chartId} failed: ${error}`);
          }
          return [key, undefined] as const;
        }
      }),
    );
    return new Map(results);
  }

  private async readCache(key: string): Promise<TenantInsightDto[] | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as TenantInsightDto[]) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: TenantInsightDto[],
  ): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), INSIGHT_CACHE_SECONDS);
    } catch {
      // A cache that cannot be written only costs a recomputation.
    }
  }
}
