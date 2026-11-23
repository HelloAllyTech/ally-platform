import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { SlackService } from '../../notification/service/slack.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { RETENTION_STATE } from '../privacy/assistant-retention.service';
import { UNTAKEN_LIMIT_MINUTES } from './crisis-flag';

/**
 * Stage 10 monitoring for the assistants build. One scheduled task (the 5-minute tick, which the
 * scheduler runs under its advisory lock so only one replica checks) runs every check below, logs a
 * `[METRIC] assistants_<check>` line per breach and posts one staff Slack message per check per
 * cooldown. Read-only: a check never changes data.
 *
 * Switches (default ON; `false`, `0` or `off` turns one off):
 *   ASSISTANT_MONITOR_ENABLED                 the whole task
 *   ASSISTANT_MONITOR_LEDGER_ENABLED          ledger reconciliation
 *   ASSISTANT_MONITOR_OUTBOX_ENABLED          alert_outbox failures and stuck rows
 *   ASSISTANT_MONITOR_UNTAKEN_ENABLED         crisis flags untaken with no alert raised (backstop)
 *   ASSISTANT_MONITOR_COST_RECORDS_ENABLED    model calls with no cost record or payer
 *   ASSISTANT_MONITOR_UNPRICED_ENABLED        events for models with no price
 *   ASSISTANT_MONITOR_FEED_ENABLED            usage-feed outage
 *   ASSISTANT_MONITOR_RETENTION_ENABLED       retention sweep row counts out of range
 * Thresholds: ASSISTANT_MONITOR_OUTBOX_MINUTES (15), ASSISTANT_MONITOR_RETENTION_MAX_ROWS (100000
 * per store), ASSISTANT_MONITOR_COOLDOWN_MINUTES (60, Slack only).
 *
 * Crisis flags untaken beyond the limit are already raised by CrisisAlertService (an `untaken:` outbox
 * row plus its own `[METRIC] crisis_flag_untaken`); this check only reports flags past the limit that
 * have NO such row, i.e. the job that raises them is not working.
 */

export type MonitorCheck =
  | 'ledger'
  | 'outbox'
  | 'untaken'
  | 'cost_records'
  | 'unpriced'
  | 'feed'
  | 'retention';

export const MONITOR_SWITCHES: Record<MonitorCheck, string> = {
  ledger: 'ASSISTANT_MONITOR_LEDGER_ENABLED',
  outbox: 'ASSISTANT_MONITOR_OUTBOX_ENABLED',
  untaken: 'ASSISTANT_MONITOR_UNTAKEN_ENABLED',
  cost_records: 'ASSISTANT_MONITOR_COST_RECORDS_ENABLED',
  unpriced: 'ASSISTANT_MONITOR_UNPRICED_ENABLED',
  feed: 'ASSISTANT_MONITOR_FEED_ENABLED',
  retention: 'ASSISTANT_MONITOR_RETENTION_ENABLED',
};
export const MONITOR_ALL_SWITCH = 'ASSISTANT_MONITOR_ENABLED';

export const MONITOR_DEFAULTS = {
  outboxMinutes: 15,
  retentionMaxRows: 100_000,
  cooldownMinutes: 60,
  /** Mirrors CREDITS.FEED_WINDOW_MS / FEED_STALL_EXPIRED_RESERVATIONS in billing. */
  feedWindowMinutes: 30,
  feedStalledReservations: 5,
  /** A micro-dollar of rounding noise is not a mismatch. */
  ledgerToleranceMicros: 1,
} as const;

export interface MonitorResult {
  check: MonitorCheck;
  breached: boolean;
  detail: string;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0) || 0;

@Injectable()
export class AssistantsMonitoringService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    AssistantsMonitoringService.name,
  );
  private readonly lastPosted = new Map<MonitorCheck, number>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly slack?: SlackService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '5min',
      'assistants-monitoring',
      async () => {
        await this.runScheduled();
      },
    );
  }

  private on(name: string): boolean {
    const raw = this.config?.get<string | boolean>(name);
    if (raw === undefined || raw === null || raw === '') return true;
    const text = String(raw).trim().toLowerCase();
    return !(text === 'false' || text === '0' || text === 'off');
  }

  private numberSetting(name: string, fallback: number): number {
    const value = Number(this.config?.get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /** The scheduled entry: run the checks, log, post. Never throws (a monitor must not break a tick). */
  async runScheduled(now = new Date()): Promise<MonitorResult[]> {
    if (!this.on(MONITOR_ALL_SWITCH)) return [];
    const results = await this.runChecks(now);
    for (const result of results.filter((r) => r.breached)) {
      this.logger.error(
        `[METRIC] assistants_${result.check} breach ${result.detail}`,
      );
      await this.post(result, now);
    }
    return results;
  }

  /** Every enabled check. A check that throws is reported as a breach of its own ("could not run"). */
  async runChecks(now = new Date()): Promise<MonitorResult[]> {
    const checks: Record<MonitorCheck, () => Promise<MonitorResult>> = {
      ledger: () => this.checkLedger(),
      outbox: () => this.checkOutbox(now),
      untaken: () => this.checkUntaken(now),
      cost_records: () => this.checkCostRecords(now),
      unpriced: () => this.checkUnpriced(now),
      feed: () => this.checkFeed(now),
      retention: () => this.checkRetention(),
    };
    const results: MonitorResult[] = [];
    for (const check of Object.keys(checks) as MonitorCheck[]) {
      if (!this.on(MONITOR_SWITCHES[check])) continue;
      try {
        results.push(await checks[check]());
      } catch (error) {
        results.push({
          check,
          breached: true,
          detail: `check could not run: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    return results;
  }

  /**
   * Per account: granted (the sum of its grants and adjustments) minus what is set aside, spent by
   * building and reserved must equal the free balance the ledger reports, and never be negative.
   * Also: an account's set-aside equals the sum of its chatbot budgets.
   */
  async checkLedger(): Promise<MonitorResult> {
    const tolerance = MONITOR_DEFAULTS.ledgerToleranceMicros;
    const rows = (await this.dataSource.query(
      `SELECT a.id, a.owner_user_id,
              a.granted_micros - a.set_aside_micros - a.builder_spent_micros - a.reserved_micros AS free,
              a.granted_micros - coalesce(g.total, 0) AS grant_drift,
              a.set_aside_micros - coalesce(b.total, 0) AS set_aside_drift
         FROM billing_accounts a
         LEFT JOIN (SELECT account_id, sum(amount_micros) AS total FROM credit_grants GROUP BY account_id) g
                ON g.account_id = a.id
         LEFT JOIN (SELECT account_id, sum(set_aside_micros) AS total FROM chatbot_budgets GROUP BY account_id) b
                ON b.account_id = a.id
        WHERE a.granted_micros - a.set_aside_micros - a.builder_spent_micros - a.reserved_micros < 0
           OR abs(a.granted_micros - coalesce(g.total, 0)) > $1
           OR abs(a.set_aside_micros - coalesce(b.total, 0)) > $1
        LIMIT 20`,
      [tolerance],
    )) as Row[];
    if (!rows.length)
      return { check: 'ledger', breached: false, detail: 'balanced' };
    const parts = rows.map(
      (r) =>
        `account=${String(r.id)} user=${String(r.owner_user_id)} free=${num(r.free)} grantDrift=${num(r.grant_drift)} setAsideDrift=${num(r.set_aside_drift)}`,
    );
    return {
      check: 'ledger',
      breached: true,
      detail: `${rows.length} account(s) do not reconcile: ${parts.join('; ')}`,
    };
  }

  /** Alerts that failed for good, or are due but still unsent, older than N minutes (last 24h). */
  async checkOutbox(now: Date): Promise<MonitorResult> {
    const minutes = this.numberSetting(
      'ASSISTANT_MONITOR_OUTBOX_MINUTES',
      MONITOR_DEFAULTS.outboxMinutes,
    );
    const [row] = (await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE state = 'failed') AS failed,
              count(*) FILTER (WHERE state IN ('pending', 'sending')) AS stuck
         FROM alert_outbox
        WHERE "updatedAt" > $1::timestamp - interval '24 hours'
          AND ((state = 'failed' AND "updatedAt" < $1::timestamp - ($2 || ' minutes')::interval)
            OR (state IN ('pending', 'sending') AND next_attempt_at < $1::timestamp - ($2 || ' minutes')::interval))`,
      [now, String(minutes)],
    )) as Row[];
    const failed = num(row?.failed);
    const stuck = num(row?.stuck);
    return {
      check: 'outbox',
      breached: failed + stuck > 0,
      detail: `failed=${failed} stuck=${stuck} olderThanMinutes=${minutes}`,
    };
  }

  /** Flags past the untaken limit that have no `untaken:` outbox row: the job raising them is down. */
  async checkUntaken(now: Date): Promise<MonitorResult> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*) AS n FROM chatbot_conversations c
        WHERE c.safety_first_at IS NOT NULL AND c.safety_taken_at IS NULL
          AND c.safety_first_at <= $1::timestamp - ($2 || ' minutes')::interval
          AND c.safety_first_at > $1::timestamp - interval '14 days'
          AND NOT EXISTS (
            SELECT 1 FROM alert_outbox o
             WHERE o.chatbot_id = c.chatbot_id AND o.dedupe_key = 'untaken:' || c.id)`,
      [now, String(UNTAKEN_LIMIT_MINUTES * 2)],
    )) as Row[];
    const n = num(row?.n);
    return {
      check: 'untaken',
      breached: n > 0,
      detail: `flagsPastLimitWithNoAlert=${n} limitMinutes=${UNTAKEN_LIMIT_MINUTES}`,
    };
  }

  /** Customer or builder model calls in the last day with no charge recorded, or no payer. */
  async checkCostRecords(now: Date): Promise<MonitorResult> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE "chargedMicros" IS NULL) AS no_cost,
              count(*) FILTER (WHERE "payerAccountId" IS NULL) AS no_payer
         FROM usage_events
        WHERE "chatbotId" IS NOT NULL
          AND "recordedAt" > $1::timestamp - interval '1 day'
          AND ("chargedMicros" IS NULL OR "payerAccountId" IS NULL)`,
      [now],
    )) as Row[];
    const noCost = num(row?.no_cost);
    const noPayer = num(row?.no_payer);
    return {
      check: 'cost_records',
      breached: noCost + noPayer > 0,
      detail: `noCost=${noCost} noPayer=${noPayer} window=1d`,
    };
  }

  /** Events whose model has no price (the ledger charged the pessimistic fallback). */
  async checkUnpriced(now: Date): Promise<MonitorResult> {
    const rows = (await this.dataSource.query(
      `SELECT coalesce("provider", '?') AS provider, coalesce("modelName", '?') AS model, count(*) AS n
         FROM usage_events
        WHERE "costMicros" IS NULL AND "chargedMicros" IS NOT NULL
          AND "recordedAt" > $1::timestamp - interval '1 day'
        GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`,
      [now],
    )) as Row[];
    const total = rows.reduce((sum, r) => sum + num(r.n), 0);
    return {
      check: 'unpriced',
      breached: total > 0,
      detail: `events=${total} models=${rows.map((r) => `${String(r.provider)}/${String(r.model)}:${num(r.n)}`).join(',') || 'none'}`,
    };
  }

  /**
   * The usage feed: ally-ai reported it off today (cost_alerts `usage_feed_off`), or reservations keep
   * expiring unsettled while nothing at all is recorded. Same test the ledger uses to stop spend.
   */
  async checkFeed(now: Date): Promise<MonitorResult> {
    const since = new Date(
      now.getTime() - MONITOR_DEFAULTS.feedWindowMinutes * 60_000,
    );
    const [row] = (await this.dataSource.query(
      `SELECT
         EXISTS (SELECT 1 FROM cost_alerts WHERE kind = 'usage_feed_off' AND day = $1::date) AS reported_off,
         (SELECT count(*) FROM credit_reservations
           WHERE expires_at >= $2 AND expires_at < $3 AND consumed_micros = 0
             AND state IN ('reserved', 'released')) AS stalled,
         EXISTS (SELECT 1 FROM usage_events WHERE "recordedAt" >= $2) AS recorded`,
      [now.toISOString().slice(0, 10), since, now],
    )) as Row[];
    const reportedOff = Boolean(row?.reported_off);
    const stalled = num(row?.stalled);
    const recorded = Boolean(row?.recorded);
    const breached =
      reportedOff ||
      (stalled >= MONITOR_DEFAULTS.feedStalledReservations && !recorded);
    return {
      check: 'feed',
      breached,
      detail: `reportedOff=${reportedOff} expiredUnsettled=${stalled} recordedInWindow=${recorded}`,
    };
  }

  /** The last retention sweep's per-store counts: any store over the expected maximum is a breach. */
  async checkRetention(): Promise<MonitorResult> {
    const max = this.numberSetting(
      'ASSISTANT_MONITOR_RETENTION_MAX_ROWS',
      MONITOR_DEFAULTS.retentionMaxRows,
    );
    const [row] = (await this.dataSource.query(
      `SELECT value FROM global_settings WHERE name = $1 LIMIT 1`,
      [RETENTION_STATE],
    )) as { value: { lastCounts?: Record<string, number> } | null }[];
    const counts = row?.value?.lastCounts;
    if (!counts)
      return { check: 'retention', breached: false, detail: 'no sweep yet' };
    const over = Object.entries(counts).filter(([, n]) => num(n) > max);
    return {
      check: 'retention',
      breached: over.length > 0,
      detail: over.length
        ? `over ${max}: ${over.map(([s, n]) => `${s}=${num(n)}`).join(',')}`
        : `all stores within ${max}`,
    };
  }

  private async post(result: MonitorResult, now: Date): Promise<void> {
    if (!this.slack) return;
    const cooldown =
      this.numberSetting(
        'ASSISTANT_MONITOR_COOLDOWN_MINUTES',
        MONITOR_DEFAULTS.cooldownMinutes,
      ) * 60_000;
    const last = this.lastPosted.get(result.check);
    if (last !== undefined && now.getTime() - last < cooldown) return;
    this.lastPosted.set(result.check, now.getTime());
    const text = `Assistants monitor: ${result.check} - ${result.detail}`;
    try {
      const sent = await this.slack.sendBlocks({
        text,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
      });
      if (!sent.ok) this.lastPosted.delete(result.check);
    } catch (error) {
      this.lastPosted.delete(result.check);
      this.logger.error(
        `[METRIC] assistants_monitor_slack_failed ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
