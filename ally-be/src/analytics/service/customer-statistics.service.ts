import { Injectable } from '@nestjs/common';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { RedisService } from '../../redis/service/redis.service';
import {
  CustomerFacts,
  attentionScore,
  customerReasons,
} from '../constants/customer-health.constants';
import {
  CustomerMover,
  CustomerOrgRow,
  CustomerOverview,
} from '../dto/customer-statistics.dto';
import { MIN_ORG_GROUP_SIZE } from '../repository/highlights-analytics.repository';
import {
  CustomerExtras,
  CustomerStatisticsRepository,
} from '../repository/customer-statistics.repository';
import {
  ORG_HEALTH_ACTIVITY_DAYS,
  ORG_HEALTH_TREND_WEEKS,
  OrgHealthAnalyticsRepository,
} from '../repository/org-health-analytics.repository';
import {
  addDays,
  isoDate,
  startOfUtcDay,
  startOfUtcWeekMonday,
} from '../util/analytics-window.util';

const MS_PER_DAY = 86_400_000;
const CACHE_KEY = 'statistics:customers:v1';
const CACHE_SECONDS = 600;
/** An organisation contacted this recently is not asking for another message yet. */
export const RECENT_CONTACT_DAYS = 7;
const MOVERS_SHOWN = 3;
/** A rise or fall is only a "mover" with this many sessions in the earlier period. */
const MOVER_MIN_SESSIONS = 10;
const RATINGS_DAYS = 90;

type BaseRow = Omit<
  CustomerOrgRow,
  'contactedAt' | 'contactNote' | 'recentlyContacted'
>;
interface BaseOverview {
  generatedAt: string;
  trendBuckets: string[];
  orgs: BaseRow[];
}

/**
 * The Customers tab on Statistics: how every customer organisation is doing, who
 * to get in touch with and why. For Ally staff only (the route is
 * `@StaffOnly()`), and held to the caller's organisation list when they have one.
 *
 * It reads what Organisation health already reads, live, plus a few counts the
 * reasons need, and keeps the result for ten minutes for the whole platform (the
 * per-caller part, the organisation list and who was contacted when, is applied
 * after the cache so one admin's list never reaches another).
 */
@Injectable()
export class CustomerStatisticsService {
  constructor(
    private readonly orgHealth: OrgHealthAnalyticsRepository,
    private readonly repo: CustomerStatisticsRepository,
    private readonly redis: RedisService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  async getOverview(
    userId: number,
    now = new Date(),
  ): Promise<CustomerOverview> {
    const [base, scope] = await Promise.all([
      this.baseOverview(now),
      this.tenantScope.resolveScope(userId),
    ]);
    const allowed = scope.tenantIds ? new Set(scope.tenantIds) : null;
    const rows = base.orgs.filter((o) => !allowed || allowed.has(o.tenantId));
    const contacts = await this.repo.latestContacts(
      rows.map((o) => o.tenantId),
    );

    const orgs: CustomerOrgRow[] = rows.map((row) => {
      const contact = contacts.get(row.tenantId);
      const recentlyContacted =
        !!contact &&
        now.getTime() - contact.at.getTime() < RECENT_CONTACT_DAYS * MS_PER_DAY;
      return {
        ...row,
        contactedAt: contact ? contact.at.toISOString() : null,
        contactNote: contact?.note ?? null,
        recentlyContacted,
      };
    });
    orgs.sort(
      (a, b) =>
        Number(a.recentlyContacted) - Number(b.recentlyContacted) ||
        b.score - a.score ||
        (b.daysSinceLastCompleted ?? 0) - (a.daysSinceLastCompleted ?? 0) ||
        a.name.localeCompare(b.name),
    );

    return {
      generatedAt: base.generatedAt,
      trendBuckets: base.trendBuckets,
      summary: {
        orgs: orgs.length,
        activeOrgs: orgs.filter((o) => o.activeLearners28d > 0).length,
        quietOrgs: orgs.filter((o) =>
          o.reasons.some((r) => r.id === 'quiet' || r.id === 'neverActive'),
        ).length,
        needsOutreach: orgs.filter((o) => o.score > 0 && !o.recentlyContacted)
          .length,
      },
      orgs,
      movers: moversOf(orgs),
    };
  }

  /** Records a contact, refusing an organisation the caller may not reach. */
  async recordContact(
    userId: number,
    tenantId: string,
    note: string | undefined,
  ): Promise<void> {
    await this.tenantScope.assertTenantInScope(tenantId, { userId });
    const trimmed = note?.trim();
    await this.repo.addContact(tenantId, userId, trimmed ? trimmed : null);
  }

  private async baseOverview(now: Date): Promise<BaseOverview> {
    const cached = await this.readCache();
    if (cached) return cached;

    const todayStart = startOfUtcDay(now);
    const endExclusive = addDays(todayStart, 1);
    const last28Start = addDays(endExclusive, -ORG_HEALTH_ACTIVITY_DAYS);
    const prev28Start = addDays(last28Start, -ORG_HEALTH_ACTIVITY_DAYS);
    const trendStart = addDays(
      startOfUtcWeekMonday(todayStart),
      -7 * (ORG_HEALTH_TREND_WEEKS - 1),
    );
    const trendBuckets = Array.from(
      { length: ORG_HEALTH_TREND_WEEKS },
      (_, i) => isoDate(addDays(trendStart, 7 * i)),
    );

    const [rows, trendRows, extras] = await Promise.all([
      this.orgHealth.getOrgRows(last28Start, prev28Start),
      this.orgHealth.getWeeklyTrend(trendStart, endExclusive),
      this.repo.getExtras(last28Start, addDays(endExclusive, -RATINGS_DAYS)),
    ]);
    const extrasByOrg = new Map<string, CustomerExtras>(
      extras.map((e) => [e.tenantId, e]),
    );
    const trendByOrg = new Map<string, Map<string, number>>();
    trendRows.forEach((t) => {
      const buckets = trendByOrg.get(t.tenantId) ?? new Map<string, number>();
      buckets.set(t.bucket, t.count);
      trendByOrg.set(t.tenantId, buckets);
    });

    const orgs: BaseRow[] = rows.map((row) => {
      const x = extrasByOrg.get(row.tenantId);
      const belowFloor = row.learners < MIN_ORG_GROUP_SIZE;
      const daysSince = row.lastCompletedAt
        ? Math.max(
            0,
            Math.floor(
              (now.getTime() - row.lastCompletedAt.getTime()) / MS_PER_DAY,
            ),
          )
        : null;
      const creditUtilisationPct =
        row.learnersWithCreditLimit > 0 && row.creditLimit > 0
          ? Math.round((row.consumedCredits / row.creditLimit) * 1000) / 10
          : null;
      const facts: CustomerFacts = {
        learners: row.learners,
        completedTotal: row.completedSimulations,
        completedLast28d: row.completedLast28d,
        completedPrev28d: row.completedPrev28d,
        daysSinceLastCompleted: daysSince,
        neverStartedLearners: x?.neverStartedLearners ?? 0,
        reviewedLast28d: x?.reviewedLast28d ?? 0,
        ratingsCount90d: x?.ratingsCount90d ?? 0,
        ratingsAverage90d: x?.ratingsAverage90d ?? null,
        creditUtilisationPct,
      };
      const reasons = customerReasons(facts);
      const byWeek = trendByOrg.get(row.tenantId);
      const reviewed28 = x?.completedLast28d ?? 0;
      return {
        tenantId: row.tenantId,
        name: row.tenantName,
        code: row.code,
        learners: row.learners,
        activeLearners28d: row.activeLearners28d,
        completedLast28d: row.completedLast28d,
        completedPrev28d: row.completedPrev28d,
        lastCompletedAt: row.lastCompletedAt
          ? row.lastCompletedAt.toISOString()
          : null,
        daysSinceLastCompleted: daysSince,
        trend: trendBuckets.map((b) => byWeek?.get(b) ?? 0),
        creditUtilisationPct,
        ratingsAverage90d:
          belowFloor || !x || x.ratingsAverage90d === null
            ? null
            : Math.round(x.ratingsAverage90d * 10) / 10,
        ratingsCount90d: x?.ratingsCount90d ?? 0,
        reviewSharePercent:
          belowFloor || reviewed28 === 0
            ? null
            : Math.round(((x?.reviewedLast28d ?? 0) / reviewed28) * 100),
        neverStartedLearners: x?.neverStartedLearners ?? 0,
        belowFloor,
        reasons,
        score: attentionScore(reasons),
      };
    });

    const base: BaseOverview = {
      generatedAt: now.toISOString(),
      trendBuckets,
      orgs,
    };
    await this.writeCache(base);
    return base;
  }

  private async readCache(): Promise<BaseOverview | null> {
    try {
      const raw = await this.redis.get(CACHE_KEY);
      return raw ? (JSON.parse(raw) as BaseOverview) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(value: BaseOverview): Promise<void> {
    try {
      await this.redis.set(CACHE_KEY, JSON.stringify(value), CACHE_SECONDS);
    } catch {
      // A cache that cannot be written only costs a recomputation.
    }
  }
}

/** The biggest rises and falls in completed sessions, over organisations with enough to compare. */
export function moversOf(
  orgs: readonly Pick<
    CustomerOrgRow,
    'tenantId' | 'name' | 'completedPrev28d' | 'completedLast28d' | 'belowFloor'
  >[],
): { up: CustomerMover[]; down: CustomerMover[] } {
  const movers = orgs
    .filter((o) => !o.belowFloor && o.completedPrev28d >= MOVER_MIN_SESSIONS)
    .map((o) => ({
      tenantId: o.tenantId,
      name: o.name,
      from: o.completedPrev28d,
      to: o.completedLast28d,
    }));
  const change = (m: CustomerMover) => (m.to - m.from) / m.from;
  return {
    up: movers
      .filter((m) => m.to > m.from)
      .sort((a, b) => change(b) - change(a))
      .slice(0, MOVERS_SHOWN),
    down: movers
      .filter((m) => m.to < m.from)
      .sort((a, b) => change(a) - change(b))
      .slice(0, MOVERS_SHOWN),
  };
}
