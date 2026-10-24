import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { userNames } from '../admin/user-names';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { GuideAlert } from '../entity/guide-alert.entity';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_POLICY,
} from '../release/guide-release.bundle';
import { CRISIS_SIGNAL_KIND } from '../safety/guide-crisis.service';

export interface AlertFiring {
  rule: string;
  severity: 'warning' | 'critical';
  /** The window this firing belongs to: one alert per rule per window. */
  window: string;
  summary: string;
  value: Record<string, unknown>;
}

/** Thresholds (plan §7.12, Appendix A; Stacks: Custom Alert Thresholds for Agent Monitoring). */
export const ALERT_THRESHOLDS = {
  minTurns: 20,
  failureWarn: 0.05,
  failureCritical: 0.2,
  ttftP95Ms: 5_000,
  costMultiple: 2,
  costFloorUsd: 5,
  crisisMultiple: 3,
  crisisMin: 3,
  anonymousCapShare: 0.8,
  cacheRatio: 0.7,
} as const;

const hourBucket = () => new Date().toISOString().slice(0, 13);
const dayBucket = () => new Date().toISOString().slice(0, 10);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

/**
 * Ally's alert rules (plans/ally-guide/plan.md §7.12, runbooks §13.4),
 * checked every 15 minutes. A firing is stored once per rule per window and
 * posted to the Ally team's channel when ALLY_GUIDE_ALERT_WEBHOOK_URL is set
 * (open question Q8); without it alerts still show in the Console. Numbers
 * only — no learner, organisation or message ever leaves in an alert.
 */
@Injectable()
export class GuideAlertService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(GuideAlertService.name);

  constructor(
    @InjectRepository(GuideAlert)
    private readonly alerts: Repository<GuideAlert>,
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('15min', 'ally-guide-alerts', () =>
      this.check().then(() => undefined),
    );
  }

  /** Evaluate every rule; store and post what newly fired. */
  async check(): Promise<GuideAlert[]> {
    const firings = await this.evaluate();
    const created: GuideAlert[] = [];
    for (const firing of firings) {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `INSERT INTO "guide_alerts" ("rule", "severity", "fingerprint", "summary", "value")
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT ("fingerprint") DO NOTHING
         RETURNING "id"`,
        [
          firing.rule,
          firing.severity,
          `${firing.rule}:${firing.window}`,
          firing.summary.slice(0, 500),
          JSON.stringify(firing.value),
        ],
      );
      const id = (Array.isArray(rows[0]) ? rows[0][0] : rows[0])?.id;
      if (!id) continue;
      const alert = (await this.alerts.findOne({ where: { id } }))!;
      created.push(alert);
      // Where it went: posted, no channel configured, or the post failed.
      const delivery = !this.config.allyGuideAlertWebhookUrl
        ? 'no_channel'
        : (await this.post(firing))
          ? 'posted'
          : 'failed';
      await this.alerts.update(id, {
        ...(delivery === 'posted' ? { notifiedAt: new Date() } : {}),
        value: { ...firing.value, delivery },
      });
    }
    return created;
  }

  async evaluate(): Promise<AlertFiring[]> {
    const policy = GUIDE_DEFAULT_POLICY;
    const T = ALERT_THRESHOLDS;
    const q = (sql: string, params: unknown[] = []) =>
      this.dataSource.query(sql, [ALLY_GUIDE_AGENT_KEY, ...params]) as Promise<
        Array<Record<string, any>>
      >;
    const [[turns], [ttft], [cost], [crisis], [anon], [cache]] =
      await Promise.all([
        q(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE "status" = 'failed')::int AS failed
             FROM "agent_turns"
            WHERE "agentKey" = $1 AND "createdAt" >= now() - interval '30 minutes'`,
        ),
        q(
          `SELECT count(*)::int AS turns,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY "ttftMs") AS p95
             FROM "agent_turns"
            WHERE "agentKey" = $1 AND "channel" = 'text' AND "ttftMs" IS NOT NULL
              AND "createdAt" >= now() - interval '1 hour'`,
        ),
        q(
          `WITH daily AS (
             SELECT date_trunc('day', "createdAt") AS day, sum("usd") AS usd
               FROM "agent_cost_ledger"
              WHERE "agentKey" = $1 AND "createdAt" >= date_trunc('day', now()) - interval '7 days'
              GROUP BY 1)
           SELECT COALESCE((SELECT usd FROM daily WHERE day = date_trunc('day', now())), 0) AS today,
                  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY usd)
                     FROM daily WHERE day < date_trunc('day', now())) AS median`,
        ),
        this.dataSource.query(
          `SELECT count(*) FILTER (WHERE "occurredAt" >= now() - interval '24 hours')::int AS today,
                  (count(*) FILTER (WHERE "occurredAt" < now() - interval '24 hours'))::float / 7 AS "dailyAverage"
             FROM "guide_signals"
            WHERE "kind" = $1 AND "occurredAt" >= now() - interval '8 days'`,
          [CRISIS_SIGNAL_KIND],
        ) as Promise<Array<Record<string, any>>>,
        q(
          `SELECT COALESCE(sum("usd"), 0) AS usd FROM "agent_cost_ledger"
            WHERE "agentKey" = $1 AND "visitorId" IS NOT NULL
              AND "createdAt" >= date_trunc('day', now())`,
        ),
        q(
          `SELECT count(*)::int AS turns,
                  COALESCE(sum(("summary"->'usage'->>'input')::bigint), 0) AS input,
                  COALESCE(sum(("summary"->'usage'->>'cacheRead')::bigint), 0) AS "cacheRead"
             FROM "agent_turn_traces"
            WHERE "agentKey" = $1 AND "createdAt" >= now() - interval '1 hour'
              AND ("summary"->'epoch'->>'isNew')::boolean IS FALSE`,
        ),
      ]);

    const firings: AlertFiring[] = [];
    const total = Number(turns?.total ?? 0);
    if (total >= T.minTurns) {
      const rate = Number(turns.failed) / total;
      if (rate > T.failureWarn) {
        firings.push({
          rule: 'turn_failures',
          severity: rate > T.failureCritical ? 'critical' : 'warning',
          window: hourBucket(),
          summary: `Ally turn failures at ${pct(rate)} over the last 30 minutes (${turns.failed} of ${total}). Runbook: provider outage / bad release.`,
          value: { rate, failed: turns.failed, total },
        });
      }
    }
    if (
      Number(ttft?.turns ?? 0) >= T.minTurns &&
      Number(ttft.p95) > T.ttftP95Ms
    ) {
      firings.push({
        rule: 'ttft_slo',
        severity: 'warning',
        window: hourBucket(),
        summary: `Text time to first token p95 is ${Math.round(Number(ttft.p95))} ms over the last hour (SLO ${T.ttftP95Ms} ms).`,
        value: { p95: Math.round(Number(ttft.p95)), turns: ttft.turns },
      });
    }
    const today = Number(cost?.today ?? 0);
    const median = cost?.median == null ? null : Number(cost.median);
    if (
      median !== null &&
      today > T.costFloorUsd &&
      today > T.costMultiple * median
    ) {
      firings.push({
        rule: 'cost_anomaly',
        severity: 'warning',
        window: dayBucket(),
        summary: `Ally spend today is $${today.toFixed(2)}, over ${T.costMultiple}× the 7-day median ($${median.toFixed(2)}). Runbook: cost anomaly.`,
        value: { today, median },
      });
    }
    const crises = Number(crisis?.today ?? 0);
    const crisisAverage = Number(crisis?.dailyAverage ?? 0);
    if (
      crises >= T.crisisMin &&
      crises > T.crisisMultiple * Math.max(crisisAverage, 1 / 7)
    ) {
      firings.push({
        rule: 'crisis_spike',
        severity: 'critical',
        window: hourBucket(),
        summary: `${crises} crisis responses in the last 24 hours, against a daily average of ${crisisAverage.toFixed(1)}. Runbook: crisis-rate spike — check the classifier and release diff.`,
        value: { last24h: crises, dailyAverage: crisisAverage },
      });
    }
    const anonUsd = Number(anon?.usd ?? 0);
    const cap = policy.limits.anonymousDailyUsdCap;
    if (anonUsd >= T.anonymousCapShare * cap) {
      firings.push({
        rule: 'anonymous_cap',
        severity: anonUsd >= cap ? 'critical' : 'warning',
        window: `${dayBucket()}:${anonUsd >= cap ? 'paused' : 'near'}`,
        summary:
          anonUsd >= cap
            ? `Anonymous chat is paused: $${anonUsd.toFixed(2)} of the $${cap} daily cap used. Runbook: anonymous flood.`
            : `Anonymous spend is $${anonUsd.toFixed(2)} of the $${cap} daily cap.`,
        value: { usd: anonUsd, cap },
      });
    }
    const input = Number(cache?.input ?? 0);
    const cacheRead = Number(cache?.cacheRead ?? 0);
    if (Number(cache?.turns ?? 0) >= T.minTurns && input + cacheRead > 0) {
      const ratio = cacheRead / (input + cacheRead);
      if (ratio < T.cacheRatio) {
        firings.push({
          rule: 'cache_health',
          severity: 'warning',
          window: hourBucket(),
          summary: `Warm threads read ${pct(ratio)} of input from cache over the last hour (target ${pct(T.cacheRatio)}): a prompt prefix may be changing every turn.`,
          value: { ratio, turns: cache.turns },
        });
      }
    }
    firings.push(...(await this.learningLoopFirings()));
    return firings;
  }

  /**
   * The learning loop's rules (plan §7.12): a canary the monitor reverted on
   * its own in the last day, and a synthetic-monitoring night that drifted.
   * Numbers and versions only.
   */
  async learningLoopFirings(): Promise<AlertFiring[]> {
    const firings: AlertFiring[] = [];
    const reverted: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT a."releaseId", a."detail", r."version"
         FROM "agent_release_audit" a
         JOIN "agent_releases" r ON r."id" = a."releaseId"
        WHERE a."agentKey" = $1 AND a."action" = 'canary_reverted'
          AND a."createdAt" >= now() - interval '24 hours'`,
      [ALLY_GUIDE_AGENT_KEY],
    );
    for (const row of reverted) {
      const reasons: string[] = Array.isArray(row.detail?.reasons)
        ? row.detail.reasons
        : [];
      firings.push({
        rule: 'canary_auto_revert',
        severity: row.detail?.emergency ? 'critical' : 'warning',
        window: String(row.releaseId),
        summary: `Canary v${row.version} was reverted automatically: ${reasons.join('; ') || 'see the release audit'}. Runbook: bad release.`,
        value: {
          releaseId: row.releaseId,
          version: row.version,
          emergency: Boolean(row.detail?.emergency),
        },
      });
    }
    const [drift]: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT s."id", s."night"::text AS night, s."passRate", s."safetyFailures",
              s."summary"->'verdict' AS verdict, r."version"
         FROM "agent_synthetic_runs" s
         JOIN "agent_releases" r ON r."id" = s."releaseId"
        WHERE s."agentKey" = $1 AND s."status" = 'completed' AND s."drift" IS TRUE
          AND s."completedAt" >= now() - interval '36 hours'
        ORDER BY s."completedAt" DESC
        LIMIT 1`,
      [ALLY_GUIDE_AGENT_KEY],
    );
    if (drift) {
      const reasons: string[] = Array.isArray(drift.verdict?.reasons)
        ? drift.verdict.reasons
        : [];
      const newly: string[] = Array.isArray(drift.verdict?.newlyFailing)
        ? drift.verdict.newlyFailing
        : [];
      firings.push({
        rule: 'synthetic_drift',
        severity: Number(drift.safetyFailures) > 0 ? 'critical' : 'warning',
        window: String(drift.night),
        summary:
          `Synthetic journeys on GA v${drift.version} drifted on ${drift.night}: ${reasons.join('; ')}` +
          (newly.length
            ? `. Newly failing: ${newly.slice(0, 5).join(', ')}`
            : '') +
          '. Runbook: provider drift / course edit.',
        value: {
          runId: drift.id,
          passRate: drift.passRate,
          safetyFailures: Number(drift.safetyFailures),
          baselineMedian: drift.verdict?.baselineMedian ?? null,
        },
      });
    }
    return firings;
  }

  /** Post to the team channel. False when there is no channel or it failed. */
  private async post(firing: AlertFiring): Promise<boolean> {
    const url = this.config.allyGuideAlertWebhookUrl;
    if (!url) return false;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `${firing.severity === 'critical' ? ':red_circle:' : ':warning:'} Ally — ${firing.summary}`,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch (error) {
      this.logger.warn(`Ally alert post failed: ${String(error)}`);
      return false;
    }
  }

  /** Newest first; `open` keeps the unacknowledged only. Names beside ids. */
  async list(limit = 50, open = false) {
    const rows = await this.alerts.find({
      where: open ? { acknowledgedAt: IsNull() } : {},
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const names = await userNames(
      this.dataSource,
      rows.map((row) => row.acknowledgedBy),
    );
    return rows.map((row) => ({
      ...row,
      delivery: (row.value?.delivery as string | undefined) ?? null,
      acknowledgedByName: row.acknowledgedBy
        ? (names.get(row.acknowledgedBy) ?? null)
        : null,
    }));
  }

  /** Counts for the Overview tile: open (unacknowledged) and all. */
  async counts(): Promise<{ open: number; total: number }> {
    const [open, total] = await Promise.all([
      this.alerts.count({ where: { acknowledgedAt: IsNull() } }),
      this.alerts.count(),
    ]);
    return { open, total };
  }

  async acknowledge(id: string, userId: number): Promise<GuideAlert> {
    const alert = await this.alerts.findOne({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    await this.alerts.update(id, {
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
    });
    return { ...alert, acknowledgedAt: new Date(), acknowledgedBy: userId };
  }
}
