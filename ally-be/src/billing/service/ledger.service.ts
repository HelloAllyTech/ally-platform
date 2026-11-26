import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  CREDITS,
  CREDITS_SETTINGS_NAME,
  CUSTOMER_CHANNELS,
  CreditsSwitches,
  DEFAULT_CREDITS_SWITCHES,
} from '../constants/credits.constants';
import type { CreditFunding } from '../entity/credit-reservation.entity';
import type { SpendPeriodKind } from '../entity/end-person-spend.entity';
import { UsageEvent } from '../entity/usage-event.entity';
import { ALLY_PAID_USAGE_KINDS, CostAlertKind } from '../enum/billing.enum';
import { periodStartsFor } from '../util/credit-periods';
import { microsToUsd, usdToMicros } from '../util/pricing.util';
import { BillingAuditService } from './billing-audit.service';
import { UsageEventListener, UsageEventService } from './usage-event.service';

/** Per-user dollar limits on one chatbot (chatbot setting `userLimits`); null or absent = none. */
export interface UserLimits {
  dailyMicros?: number | null;
  weeklyMicros?: number | null;
  monthlyMicros?: number | null;
}

/** Why the ledger refused a run. Every one of these is the OUT_OF_CREDITS state to a customer. */
export type CreditBlockReason =
  /** No account can pay: no creator known, or (customers) no budget was ever set. */
  | 'no_payer'
  | 'account_suspended'
  | 'budget_empty'
  | 'free_balance_empty'
  | 'person_daily'
  | 'person_weekly'
  | 'person_monthly'
  /** The usage feed has stopped: spend could not be counted, so none is allowed. */
  | 'feed_off'
  /** The ledger could not be read and the grace ran out: fail closed. */
  | 'ledger_unavailable';

export interface ReserveInput {
  /** The run id ally-ai is sent: a retried message finds its reservation instead of a new one. */
  runId: string;
  funding: CreditFunding;
  estimateMicros: number;
  chatbotId?: string | null;
  draftId?: string | null;
  /** Who built it: pays for building when the chatbot has no budget yet. */
  creatorUserId?: number | null;
  endPersonId?: string | null;
  userLimits?: UserLimits | null;
  timeZone?: string | null;
  now?: Date;
}

export type ReserveResult =
  | { ok: true; accountId: string; reservationId: string; reused: boolean }
  | { ok: false; reason: CreditBlockReason; accountId: string | null };

const LIMIT_KIND: Record<SpendPeriodKind, keyof UserLimits> = {
  day: 'dailyMicros',
  week: 'weeklyMicros',
  month: 'monthlyMicros',
};
const PERSON_REASON: Record<SpendPeriodKind, CreditBlockReason> = {
  day: 'person_daily',
  week: 'person_weekly',
  month: 'person_monthly',
};

/** Thrown inside a transaction to roll it back with a reason. */
class Refused extends Error {
  constructor(readonly reason: CreditBlockReason) {
    super(reason);
  }
}

const n = (value: unknown): number => Number(value ?? 0) || 0;
const usd = (micros: unknown) => microsToUsd(n(micros));

export interface PausedJob {
  kind: string;
  subjectId: string;
  accountId: string | null;
  ownerUserId: number | null;
  payload: Record<string, any>;
}

/** A listener told after money moved, outside the transaction (the warning emails). */
export interface LedgerWatcher {
  afterSpend(subject: { accountId?: string; budgetId?: string }): void;
}

/**
 * The credits ledger (stage 6, D1/R2 and the Ledger, Payer and Ledger-edges rules in section 3).
 *
 *   free balance     = granted - set aside - builder spend - reserved (free)
 *   budget remaining = set aside - customer spend - reserved (budget)
 *
 * Building and testing are paid from the free balance only; customers only from their chatbot's
 * budget. A reservation is one conditional UPDATE (`... WHERE remaining >= estimate RETURNING`),
 * so concurrent turns cannot all pass. Usage recorded for the run settles it (this is a
 * `UsageEventListener`, in the same transaction the event is inserted in); a sweep releases what an
 * expired reservation did not use, and a nightly rebuild sets every counter from its rows.
 */
@Injectable()
export class LedgerService implements UsageEventListener, OnModuleInit {
  private readonly logger = LoggerService.getInstance(LedgerService.name);
  private switchesCache: { at: number; value: CreditsSwitches } | null = null;
  private feedCache: { at: number; healthy: boolean } | null = null;
  /** When the "feed is off but not blocking" warning was last logged (once an hour). */
  private feedOffWarnedAt = 0;
  private readonly watchers: LedgerWatcher[] = [];
  private readonly resumers = new Map<
    string,
    (job: PausedJob) => Promise<void>
  >();
  /**
   * Extra resume steps for work paused outside `credit_paused_jobs` (a document whose job row was
   * lost, a crawl's stale pause marker). Each returns how many items it resumed.
   */
  private readonly sweepers = new Map<string, () => Promise<number>>();

  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly usage?: UsageEventService,
    @Optional() private readonly audit?: BillingAuditService,
  ) {}

  onModuleInit(): void {
    this.usage?.addListener(this);
    scheduledTaskRegistry.register(
      '5min',
      'credits-release-expired',
      async () => {
        await this.releaseExpired();
        await this.resumePaused();
      },
    );
    scheduledTaskRegistry.register(
      'daily',
      'credits-rebuild-counters',
      async () => {
        await this.rebuild();
        // Nightly: anything still paused whose reason no longer applies runs again.
        await this.resumeAllPaused().catch((error) =>
          this.logger.warn(
            `Nightly resume of paused work failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          ),
        );
      },
    );
  }

  addWatcher(watcher: LedgerWatcher): void {
    this.watchers.push(watcher);
  }

  // ── paused background work ──────────────────────────────────────────

  /**
   * Background AI work with nobody watching (site reading, re-indexing) pauses at a zero free
   * balance rather than failing: the job is kept here and resumed by the sweep once its account
   * has credits again (section 3, "Background AI with no user present").
   */
  async pauseJob(job: {
    kind: string;
    subjectId: string;
    accountId: string | null;
    ownerUserId: number | null;
    reason: CreditBlockReason;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO credit_paused_jobs (kind, subject_id, account_id, owner_user_id, reason, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        job.kind,
        job.subjectId,
        job.accountId,
        job.ownerUserId,
        job.reason,
        JSON.stringify(job.payload),
      ],
    );
  }

  /** What is paused for a subject (a draft, a document): the "paused: out of credits" state. */
  async pausedFor(
    subjectId: string,
  ): Promise<Array<{ kind: string; reason: string; since: Date }>> {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT kind, reason, min(created_at) AS since FROM credit_paused_jobs
        WHERE subject_id = $1 GROUP BY kind, reason`,
      [subjectId],
    );
    return rows.map((r) => ({
      kind: r.kind,
      reason: r.reason,
      since: r.since,
    }));
  }

  /** Paused jobs of a builder, for the Credits page. */
  async pausedForUser(userId: number) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT kind, subject_id, reason, min(created_at) AS since, count(*)::int AS batches
         FROM credit_paused_jobs WHERE owner_user_id = $1 GROUP BY 1, 2, 3 ORDER BY 4`,
      [userId],
    );
    return rows.map((r) => ({
      kind: r.kind as string,
      subjectId: r.subject_id as string,
      reason: r.reason as string,
      since: r.since as Date,
      batches: r.batches as number,
    }));
  }

  registerResumer(
    kind: string,
    handler: (job: PausedJob) => Promise<void>,
  ): void {
    this.resumers.set(kind, handler);
  }

  registerSweeper(name: string, sweep: () => Promise<number>): void {
    this.sweepers.set(name, sweep);
  }

  /**
   * Resume everything paused for credits whose reason no longer applies: every claimable
   * `credit_paused_jobs` row, then each registered sweeper (documents left at "Paused:" with no
   * job row, crawls' stale pause markers). Idempotent: a job whose reason still holds is paused
   * again by its own gate, and a second call finds nothing new. While a stopped usage feed blocks
   * spend nothing is resumed (it would only pause again).
   */
  async resumeAllPaused(): Promise<{
    jobs: number;
    swept: Record<string, number>;
    skipped: 'feed_off' | null;
  }> {
    if (await this.feedBlocksSpend()) {
      return { jobs: 0, swept: {}, skipped: 'feed_off' };
    }
    let jobs = 0;
    for (let round = 0; round < 20; round++) {
      const resumed = await this.resumePaused(50);
      jobs += resumed;
      if (resumed < 50) break;
    }
    const swept: Record<string, number> = {};
    for (const [name, sweep] of this.sweepers) {
      try {
        swept[name] = await sweep();
      } catch (error) {
        swept[name] = 0;
        this.logger.warn(
          `Resume sweep ${name} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
    if (jobs || Object.values(swept).some(Boolean)) {
      this.logger.info(
        `Credits: resumed ${jobs} paused job(s); swept ${JSON.stringify(swept)}`,
      );
    }
    return { jobs, swept, skipped: null };
  }

  /** Resume paused jobs whose account has credits again. Each job is claimed (deleted) first. */
  async resumePaused(limit = 50): Promise<number> {
    if (!this.resumers.size) return 0;
    // A stopped feed that blocks spend would pause every one of them again at once.
    if (await this.feedBlocksSpend().catch(() => true)) return 0;
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `DELETE FROM credit_paused_jobs WHERE id IN (
         SELECT j.id FROM credit_paused_jobs j
           LEFT JOIN billing_accounts a
             ON a.id = coalesce(j.account_id, (SELECT id FROM billing_accounts WHERE owner_user_id = j.owner_user_id))
          WHERE j.kind = ANY($1)
            AND a.status = 'active'
            AND a.granted_micros - a.set_aside_micros - a.builder_spent_micros - a.reserved_micros > 0
          ORDER BY j.created_at LIMIT $2 FOR UPDATE OF j SKIP LOCKED)
       RETURNING *`,
      [[...this.resumers.keys()], limit],
    );
    for (const row of returned(rows) as Array<Record<string, any>>) {
      const handler = this.resumers.get(row.kind);
      try {
        await handler?.({
          kind: row.kind,
          subjectId: row.subject_id,
          accountId: row.account_id,
          ownerUserId: row.owner_user_id,
          payload: row.payload ?? {},
        });
      } catch (error) {
        this.logger.warn(
          `Resuming paused ${row.kind} for ${row.subject_id} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
    return (returned(rows) as unknown[]).length;
  }

  // ── switches and feed ───────────────────────────────────────────────

  /**
   * The kill switches. A missing row means ON locally and OFF in production, so deploying this
   * changes nothing live until the cutover runbook grants credits and switches enforcement on
   * (stage 10). An unreadable row keeps the default.
   */
  async switches(): Promise<CreditsSwitches> {
    if (this.switchesCache && Date.now() - this.switchesCache.at < 30_000) {
      return this.switchesCache.value;
    }
    let value: CreditsSwitches =
      process.env.NODE_ENV === 'production'
        ? { enforcement: false, warningEmails: false }
        : DEFAULT_CREDITS_SWITCHES;
    try {
      const [row] = await this.dataSource.query(
        `SELECT value FROM global_settings WHERE name = $1 LIMIT 1`,
        [CREDITS_SETTINGS_NAME],
      );
      if (row?.value && typeof row.value === 'object') {
        value = {
          enforcement:
            typeof row.value.enforcement === 'boolean'
              ? row.value.enforcement
              : value.enforcement,
          warningEmails:
            typeof row.value.warningEmails === 'boolean'
              ? row.value.warningEmails
              : value.warningEmails,
        };
      }
    } catch {
      // The default stands; a database that can't be read is handled by the gate's grace.
    }
    this.switchesCache = { at: Date.now(), value };
    return value;
  }

  /** Forget cached switches and feed health (tests, and after an admin change). */
  invalidate(): void {
    this.switchesCache = null;
    this.feedCache = null;
  }

  /**
   * Is the usage feed recording? Off when ally-ai reported it off today (the existing
   * USAGE_FEED_OFF alert), or when reservations keep expiring unsettled while no usage at all is
   * recorded. While it is off no new spend is allowed: nothing would be counted.
   */
  async feedHealthy(now = new Date()): Promise<boolean> {
    if (
      this.feedCache &&
      now.getTime() - this.feedCache.at < CREDITS.FEED_CHECK_TTL_MS
    ) {
      return this.feedCache.healthy;
    }
    const since = new Date(now.getTime() - CREDITS.FEED_WINDOW_MS);
    const [row] = await this.dataSource.query(
      `SELECT
         EXISTS (SELECT 1 FROM cost_alerts WHERE kind = $1 AND day = $2::date) AS "reportedOff",
         (SELECT count(*) FROM credit_reservations
           WHERE expires_at >= $3 AND expires_at < $4 AND consumed_micros = 0
             AND state IN ('reserved', 'released')) AS "stalled",
         EXISTS (SELECT 1 FROM usage_events WHERE "recordedAt" >= $3) AS "recorded"`,
      [
        CostAlertKind.USAGE_FEED_OFF,
        now.toISOString().slice(0, 10),
        since,
        now,
      ],
    );
    const healthy =
      !row?.reportedOff &&
      !(
        n(row?.stalled) >= CREDITS.FEED_STALL_EXPIRED_RESERVATIONS &&
        !row?.recorded
      );
    this.feedCache = { at: now.getTime(), healthy };
    return healthy;
  }

  /**
   * Whether the usage feed being off blocks new spend (the design rule "a feed that stops
   * recording blocks new spend"). Only where the rule protects real money: in production, or
   * wherever `ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF=true`. Elsewhere (local and dev, where ally-ai
   * usually has no usage queue and nothing ever settles) a stopped feed is logged once an hour and
   * work goes ahead with its cost unrecorded. `ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF=false` turns
   * the block off in production too.
   */
  async feedBlocksSpend(now = new Date()): Promise<boolean> {
    if (await this.feedHealthy(now)) return false;
    if (blockOnFeedOff()) return true;
    if (now.getTime() - this.feedOffWarnedAt >= 3_600_000) {
      this.feedOffWarnedAt = now.getTime();
      this.logger.warn(
        'Credits: the usage feed is not recording (no usage events arrive), but ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF is off here, so work goes ahead with its cost unrecorded. Set LLM_USAGE__QUEUE_URL in ally-ai to record it.',
      );
    }
    return false;
  }

  // ── accounts ────────────────────────────────────────────────────────

  /**
   * Staff grants to someone who has never built a chatbot have no account to pick, so they
   * name the person by the email they sign in with. Case-insensitive; never guesses between two.
   */
  private async userIdByEmail(
    email: string,
    manager: EntityManager,
  ): Promise<number> {
    const rows: Array<{ id: number }> = await manager.query(
      `SELECT id FROM users WHERE lower(email) = lower($1) ORDER BY id LIMIT 2`,
      [email.trim()],
    );
    if (!rows.length) {
      throw new NotFoundException(
        'No one signs in with that email. Check it, or create their login first.',
      );
    }
    if (rows.length > 1) {
      throw new ConflictException(
        'More than one login uses that email. Grant from their account instead.',
      );
    }
    return Number(rows[0].id);
  }

  /** The builder's account, created on first use (every builder starts at $0, D1). */
  async accountFor(
    userId: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<string> {
    const [row] = await manager.query(
      `INSERT INTO billing_accounts (owner_user_id) VALUES ($1)
       ON CONFLICT (owner_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id
       RETURNING id`,
      [userId],
    );
    return row.id;
  }

  /** The account that already exists for a user, without creating one. */
  async findAccount(userId: number): Promise<string | null> {
    const [row] = await this.dataSource.query(
      `SELECT id FROM billing_accounts WHERE owner_user_id = $1`,
      [userId],
    );
    return row?.id ?? null;
  }

  /** The chatbot's open budget, if one was ever set. */
  async openBudget(
    chatbotId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<{
    id: string;
    accountId: string;
    setAside: number;
    spent: number;
    reserved: number;
    epoch: number;
  } | null> {
    const [row] = await manager.query(
      `SELECT id, account_id, set_aside_micros, spent_micros, reserved_micros, epoch
         FROM chatbot_budgets WHERE chatbot_id = $1 AND archived_at IS NULL`,
      [chatbotId],
    );
    return row
      ? {
          id: row.id,
          accountId: row.account_id,
          setAside: n(row.set_aside_micros),
          spent: n(row.spent_micros),
          reserved: n(row.reserved_micros),
          epoch: n(row.epoch),
        }
      : null;
  }

  /** Whoever built the chatbot or draft: they pay for building it. */
  private async creatorOf(
    manager: EntityManager,
    input: Pick<ReserveInput, 'chatbotId' | 'draftId' | 'creatorUserId'>,
  ): Promise<number | null> {
    if (input.creatorUserId) return input.creatorUserId;
    if (input.chatbotId) {
      const [row] = await manager.query(
        `SELECT created_by FROM chatbots WHERE id = $1`,
        [input.chatbotId],
      );
      if (row?.created_by) return row.created_by;
    }
    if (input.draftId) {
      const [row] = await manager.query(
        `SELECT owner_user_id FROM bot_drafts WHERE id = $1`,
        [input.draftId],
      );
      if (row?.owner_user_id) return row.owner_user_id;
    }
    return null;
  }

  /**
   * The account that pays for building this chatbot or draft: the one that holds its budget, else
   * its creator's. Null when there is nobody (missing payer counts as blocked, never as free).
   */
  async builderPayer(
    input: Pick<ReserveInput, 'chatbotId' | 'draftId' | 'creatorUserId'>,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<string | null> {
    if (input.chatbotId) {
      const budget = await this.openBudget(input.chatbotId, manager);
      if (budget) return budget.accountId;
    }
    const creator = await this.creatorOf(manager, input);
    return creator ? this.accountFor(creator, manager) : null;
  }

  // ── reservations ────────────────────────────────────────────────────

  /**
   * Hold money for one run before any model call. Idempotent on the run id: a retried message
   * reuses its reservation. Refused (and nothing held) when any of the account, the budget or the
   * person's limits would go past its line.
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const now = input.now ?? new Date();
    const estimate = Math.max(1, Math.round(input.estimateMicros));
    let accountId: string | null = null;
    try {
      return await this.dataSource.transaction(async (manager) => {
        const [existing] = await manager.query(
          `SELECT id, account_id FROM credit_reservations WHERE run_id = $1`,
          [input.runId],
        );
        if (existing) {
          return {
            ok: true as const,
            accountId: existing.account_id as string,
            reservationId: existing.id as string,
            reused: true,
          };
        }

        let budgetId: string | null = null;
        if (input.funding === 'budget') {
          const budget = input.chatbotId
            ? await this.openBudget(input.chatbotId, manager)
            : null;
          if (!budget) throw new Refused('no_payer');
          accountId = budget.accountId;
          budgetId = budget.id;
        } else {
          accountId = await this.builderPayer(input, manager);
          if (!accountId) throw new Refused('no_payer');
        }

        const [account] = await manager.query(
          `SELECT status FROM billing_accounts WHERE id = $1`,
          [accountId],
        );
        if (!account) throw new Refused('no_payer');
        if (account.status !== 'active') throw new Refused('account_suspended');

        const [claimed] = await manager.query(
          `INSERT INTO credit_reservations
             (run_id, account_id, chatbot_id, end_person_id, funding, reserved_micros, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (run_id) DO NOTHING RETURNING id`,
          [
            input.runId,
            accountId,
            input.chatbotId ?? null,
            input.endPersonId ?? null,
            input.funding,
            estimate,
            new Date(now.getTime() + CREDITS.RESERVATION_TTL_MS),
          ],
        );
        if (!claimed) {
          // The same run, reserved concurrently by a redelivery: theirs stands.
          const [other] = await manager.query(
            `SELECT id, account_id FROM credit_reservations WHERE run_id = $1`,
            [input.runId],
          );
          return {
            ok: true as const,
            accountId: other.account_id as string,
            reservationId: other.id as string,
            reused: true,
          };
        }

        if (budgetId) {
          const held = await manager.query(
            `UPDATE chatbot_budgets
                SET reserved_micros = reserved_micros + $2, updated_at = now()
              WHERE id = $1 AND archived_at IS NULL
                AND set_aside_micros - spent_micros - reserved_micros >= $2
              RETURNING id`,
            [budgetId, estimate],
          );
          if (!returned(held).length) throw new Refused('budget_empty');
        } else {
          const held = await manager.query(
            `UPDATE billing_accounts
                SET reserved_micros = reserved_micros + $2, updated_at = now()
              WHERE id = $1 AND status = 'active'
                AND granted_micros - set_aside_micros - builder_spent_micros - reserved_micros >= $2
              RETURNING id`,
            [accountId, estimate],
          );
          if (!returned(held).length) throw new Refused('free_balance_empty');
        }

        const periods: Array<{ kind: SpendPeriodKind; start: string }> = [];
        if (input.endPersonId && input.chatbotId && input.userLimits) {
          const starts = periodStartsFor(now, input.timeZone);
          for (const kind of ['day', 'week', 'month'] as SpendPeriodKind[]) {
            const limit = input.userLimits[LIMIT_KIND[kind]];
            if (limit === null || limit === undefined || !(Number(limit) >= 0))
              continue;
            await manager.query(
              `INSERT INTO end_person_spend (end_person_id, period_kind, period_start, chatbot_id)
               VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [input.endPersonId, kind, starts[kind], input.chatbotId],
            );
            const held = await manager.query(
              `UPDATE end_person_spend
                  SET reserved_micros = reserved_micros + $4, updated_at = now()
                WHERE end_person_id = $1 AND period_kind = $2 AND period_start = $3
                  AND spent_micros + reserved_micros + $4 <= $5
                RETURNING end_person_id`,
              [input.endPersonId, kind, starts[kind], estimate, Number(limit)],
            );
            if (!returned(held).length) throw new Refused(PERSON_REASON[kind]);
            periods.push({ kind, start: starts[kind] });
          }
          if (periods.length) {
            await manager.query(
              `UPDATE credit_reservations SET periods = $2 WHERE id = $1`,
              [claimed.id, JSON.stringify(periods)],
            );
          }
        }
        return {
          ok: true as const,
          accountId: accountId!,
          reservationId: claimed.id as string,
          reused: false,
        };
      });
    } catch (error) {
      if (error instanceof Refused) {
        return { ok: false, reason: error.reason, accountId };
      }
      throw error;
    }
  }

  /** Give back what a reservation holds now (a run that never started its model calls). */
  async release(runId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const [res] = await manager.query(
        `SELECT * FROM credit_reservations WHERE run_id = $1 AND state = 'reserved' FOR UPDATE`,
        [runId],
      );
      if (res) await this.releaseRow(manager, res);
    });
  }

  /** The sweep: every expired reservation gives back what it did not use. */
  async releaseExpired(now = new Date()): Promise<number> {
    let released = 0;
    for (;;) {
      const batch = await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query(
          `SELECT * FROM credit_reservations
            WHERE state = 'reserved' AND expires_at < $1
            ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED`,
          [now],
        );
        for (const row of rows) await this.releaseRow(manager, row);
        return rows.length as number;
      });
      released += batch;
      if (batch < 200) return released;
    }
  }

  private async releaseRow(
    manager: EntityManager,
    res: Record<string, any>,
  ): Promise<void> {
    const leftover = Math.max(
      0,
      n(res.reserved_micros) - n(res.consumed_micros),
    );
    if (leftover > 0) {
      if (res.funding === 'budget') {
        // An archived budget also lets go of the set-aside it kept for this run.
        await manager.query(
          `UPDATE chatbot_budgets SET reserved_micros = greatest(0, reserved_micros - $2),
                  set_aside_micros = CASE WHEN archived_at IS NULL THEN set_aside_micros
                                          ELSE greatest(spent_micros, set_aside_micros - $2) END,
                  updated_at = now()
            WHERE chatbot_id = $1 AND account_id = $3
              AND id = (SELECT id FROM chatbot_budgets WHERE chatbot_id = $1 AND account_id = $3
                         ORDER BY archived_at IS NULL DESC, created_at DESC LIMIT 1)`,
          [res.chatbot_id, leftover, res.account_id],
        );
        await this.recomputeAccountSetAside(manager, res.account_id);
      } else {
        await manager.query(
          `UPDATE billing_accounts SET reserved_micros = greatest(0, reserved_micros - $2), updated_at = now()
            WHERE id = $1`,
          [res.account_id, leftover],
        );
      }
      for (const period of (res.periods ?? []) as Array<{
        kind: string;
        start: string;
      }>) {
        await manager.query(
          `UPDATE end_person_spend SET reserved_micros = greatest(0, reserved_micros - $4), updated_at = now()
            WHERE end_person_id = $1 AND period_kind = $2 AND period_start = $3`,
          [res.end_person_id, period.kind, period.start, leftover],
        );
      }
    }
    await manager.query(
      `UPDATE credit_reservations
          SET state = CASE WHEN consumed_micros > 0 THEN 'settled' ELSE 'released' END,
              settled_at = now()
        WHERE id = $1`,
      [res.id],
    );
  }

  // ── settling: called for every newly recorded usage event ───────────

  async onUsageRecorded(
    manager: EntityManager,
    event: UsageEvent,
  ): Promise<void> {
    // R4: indexing an Ally template's knowledge is Ally's cost, never a builder's.
    // Stage 9: so is the safety-pack release suite.
    if (ALLY_PAID_USAGE_KINDS.has(event.kind as string)) return;
    const charge = n(event.chargedMicros ?? event.costMicros);
    const [res] = await manager.query(
      `SELECT * FROM credit_reservations WHERE run_id = $1 FOR UPDATE`,
      [event.runId],
    );

    let accountId: string | null =
      res?.account_id ?? event.payerAccountId ?? null;
    let funding: CreditFunding;
    if (res) funding = res.funding;
    else
      funding =
        CUSTOMER_CHANNELS.has(event.channel) && event.chatbotId
          ? 'budget'
          : 'free';

    let budgetId: string | null = null;
    if (funding === 'budget' && event.chatbotId) {
      const [budget] = await manager.query(
        `SELECT id, account_id FROM chatbot_budgets
          WHERE chatbot_id = $1 ${accountId ? 'AND account_id = $2' : ''}
          ORDER BY archived_at IS NULL DESC, created_at DESC LIMIT 1`,
        accountId ? [event.chatbotId, accountId] : [event.chatbotId],
      );
      if (budget) {
        budgetId = budget.id;
        accountId = budget.account_id;
      } else {
        // Customer spend with no budget (credits off, or before cutover): it is still spent,
        // and the honest place for it is the creator's account.
        funding = 'free';
      }
    }
    if (!accountId) {
      accountId = await this.builderPayer(
        {
          chatbotId: event.chatbotId,
          draftId: event.draftId,
          creatorUserId: event.creatorUserId,
        },
        manager,
      ).catch(() => null);
    }
    const endPersonId: string | null =
      res?.end_person_id ?? event.endPersonId ?? null;

    await manager.query(
      `UPDATE usage_events SET "payerAccountId" = $2, "endPersonId" = $3, funding = $4,
              "chargedMicros" = coalesce("chargedMicros", "costMicros")
        WHERE id = $1`,
      [event.id, accountId, endPersonId, accountId ? funding : null],
    );
    if (!accountId || !(charge > 0)) return;

    // Only a live reservation still holds money; a released one already gave its leftover back.
    const take =
      res && res.state === 'reserved'
        ? Math.min(
            charge,
            Math.max(0, n(res.reserved_micros) - n(res.consumed_micros)),
          )
        : 0;
    if (res) {
      await manager.query(
        `UPDATE credit_reservations SET consumed_micros = consumed_micros + $2 WHERE id = $1`,
        [res.id, charge],
      );
    }
    if (budgetId) {
      await manager.query(
        `UPDATE chatbot_budgets SET spent_micros = spent_micros + $2,
                reserved_micros = greatest(0, reserved_micros - $3), updated_at = now()
          WHERE id = $1`,
        [budgetId, charge, take],
      );
    } else {
      await manager.query(
        `UPDATE billing_accounts SET builder_spent_micros = builder_spent_micros + $2,
                reserved_micros = greatest(0, reserved_micros - $3), updated_at = now()
          WHERE id = $1`,
        [accountId, charge, res?.funding === 'free' ? take : 0],
      );
    }

    if (endPersonId && event.chatbotId) {
      const zone = await this.timeZoneOf(manager, event.chatbotId);
      const starts = periodStartsFor(event.createdAt ?? new Date(), zone);
      const heldIn = new Map<string, string>(
        ((res?.periods ?? []) as Array<{ kind: string; start: string }>).map(
          (p) => [p.kind, p.start],
        ),
      );
      for (const kind of ['day', 'week', 'month'] as SpendPeriodKind[]) {
        await manager.query(
          `INSERT INTO end_person_spend (end_person_id, period_kind, period_start, chatbot_id, spent_micros)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (end_person_id, period_kind, period_start)
             DO UPDATE SET spent_micros = end_person_spend.spent_micros + EXCLUDED.spent_micros, updated_at = now()`,
          [endPersonId, kind, starts[kind], event.chatbotId, charge],
        );
        const held = heldIn.get(kind);
        if (held && take > 0) {
          await manager.query(
            `UPDATE end_person_spend SET reserved_micros = greatest(0, reserved_micros - $4)
              WHERE end_person_id = $1 AND period_kind = $2 AND period_start = $3`,
            [endPersonId, kind, held, take],
          );
        }
      }
    }

    const subject = budgetId ? { budgetId } : { accountId };
    setImmediate(() => {
      for (const watcher of this.watchers) {
        try {
          watcher.afterSpend(subject);
        } catch {
          // a warning never fails a recording
        }
      }
    });
  }

  private async timeZoneOf(
    manager: EntityManager,
    chatbotId: string,
  ): Promise<string | null> {
    const [row] = await manager.query(
      `SELECT settings->>'timeZone' AS zone FROM chatbots WHERE id = $1`,
      [chatbotId],
    );
    return row?.zone ?? null;
  }

  // ── grants (Ally staff) ─────────────────────────────────────────────

  /**
   * Add credits (`grant`, positive) or take some back (`adjustment`, either sign). A negative
   * adjustment can never take the account below what it has spent plus what it has set aside.
   * Every grant opens a new warning epoch, so the 50/80/95% emails re-arm.
   */
  async grant(
    input: {
      userId?: number;
      accountId?: string;
      /** The person by sign-in email, for someone with no account yet. */
      email?: string;
      amountUsd: number;
      kind: 'grant' | 'adjustment';
      note: string;
      idempotencyKey?: string | null;
    },
    actor: number | null,
  ): Promise<{
    grantId: string | null;
    accountId: string;
    duplicate: boolean;
  }> {
    const note = BillingAuditService.requireNote(input.note);
    const amount = usdToMicros(Number(input.amountUsd));
    if (!Number.isFinite(amount) || amount === 0) {
      throw new BadRequestException('Give an amount other than $0.');
    }
    if (input.kind === 'grant' && amount < 0) {
      throw new BadRequestException(
        'A grant adds credits; use an adjustment to take some back.',
      );
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const userId =
        input.userId ??
        (input.email?.trim()
          ? await this.userIdByEmail(input.email, manager)
          : undefined);
      const accountId =
        input.accountId ??
        (userId ? await this.accountFor(userId, manager) : null);
      if (!accountId)
        throw new BadRequestException(
          'Name the account, the user or their email.',
        );
      if (input.idempotencyKey) {
        const [done] = await manager.query(
          `SELECT id FROM credit_grants WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        );
        if (done) return { grantId: done.id, accountId, duplicate: true };
      }
      const updated = returned(
        await manager.query(
          `UPDATE billing_accounts
              SET granted_micros = granted_micros + $2,
                  grant_epoch = grant_epoch + CASE WHEN $2 > 0 THEN 1 ELSE 0 END,
                  updated_at = now()
            WHERE id = $1
              AND granted_micros + $2 >= set_aside_micros + builder_spent_micros + reserved_micros
            RETURNING grant_epoch, granted_micros`,
          [accountId, amount],
        ),
      );
      if (!updated.length) {
        const [exists] = await manager.query(
          `SELECT 1 FROM billing_accounts WHERE id = $1`,
          [accountId],
        );
        if (!exists) throw new NotFoundException('No such account.');
        throw new ConflictException(
          'That would take the account below what it has already spent and set aside for its chatbots.',
        );
      }
      const [grant] = await manager.query(
        `INSERT INTO credit_grants (account_id, amount_micros, kind, note, granted_by, epoch, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          accountId,
          amount,
          input.kind,
          note,
          actor,
          (updated[0] as { grant_epoch: number }).grant_epoch,
          input.idempotencyKey ?? null,
        ],
      );
      await this.audit?.record(
        {
          subjectType: 'credits',
          subjectId: accountId,
          action: input.kind,
          before: null,
          after: { amountMicros: amount },
          note,
          actorUserId: actor,
        },
        manager,
      );
      return { grantId: grant.id as string, accountId, duplicate: false };
    });
    // A grant may be what paused work was waiting for: resume it now, not at the next sweep.
    if (!result.duplicate && amount > 0) {
      setImmediate(() => {
        void this.resumeAllPaused().catch((error) =>
          this.logger.warn(
            `Resume after grant failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          ),
        );
      });
    }
    return result;
  }

  // ── budgets ─────────────────────────────────────────────────────────

  /**
   * Set how much is set aside for a chatbot's customers. Raising it moves money from the free
   * balance (refused without enough); lowering it is clamped at what is spent and held, and gives
   * the rest back. The first budget is paid by the chatbot's creator. A raise opens a new warning
   * epoch. `warning` is set when the free balance left is under the reserve.
   */
  async setBudget(
    chatbotId: string,
    setAsideUsd: number,
    actor: number | null,
  ): Promise<{
    setAsideMicros: number;
    clamped: boolean;
    warning: string | null;
  }> {
    const target = usdToMicros(Number(setAsideUsd));
    if (!Number.isFinite(target) || target < 0) {
      throw new BadRequestException('A budget is $0 or more.');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      let budget = await this.openBudget(chatbotId, manager);
      if (!budget) {
        const accountId = await this.builderPayer({ chatbotId }, manager);
        if (!accountId)
          throw new NotFoundException(
            'This chatbot has no owner to pay for it.',
          );
        await manager.query(
          `INSERT INTO chatbot_budgets (account_id, chatbot_id) VALUES ($1, $2)`,
          [accountId, chatbotId],
        );
        budget = (await this.openBudget(chatbotId, manager))!;
      }
      // Locked for the change: settlement and reservations wait.
      const [locked] = await manager.query(
        `SELECT set_aside_micros, spent_micros, reserved_micros FROM chatbot_budgets WHERE id = $1 FOR UPDATE`,
        [budget.id],
      );
      const floor = n(locked.spent_micros) + n(locked.reserved_micros);
      const next = Math.max(target, floor);
      const delta = next - n(locked.set_aside_micros);
      if (delta > 0) {
        const moved = returned(
          await manager.query(
            `UPDATE billing_accounts SET set_aside_micros = set_aside_micros + $2, updated_at = now()
              WHERE id = $1 AND status = 'active'
                AND granted_micros - set_aside_micros - builder_spent_micros - reserved_micros >= $2
              RETURNING id`,
            [budget.accountId, delta],
          ),
        );
        if (!moved.length) {
          throw new ConflictException({
            errorCode: 'CREDITS_FREE_BALANCE_TOO_LOW',
            message:
              'Your free balance is too low for that budget. Contact Ally for more credits.', // COPY: needs approval
          });
        }
      } else if (delta < 0) {
        await manager.query(
          `UPDATE billing_accounts SET set_aside_micros = greatest(0, set_aside_micros + $2), updated_at = now() WHERE id = $1`,
          [budget.accountId, delta],
        );
      }
      await manager.query(
        `UPDATE chatbot_budgets SET set_aside_micros = $2,
                epoch = epoch + CASE WHEN $3 > 0 THEN 1 ELSE 0 END, updated_at = now()
          WHERE id = $1`,
        [budget.id, next, delta],
      );
      await this.audit?.record(
        {
          subjectType: 'chatbot_budget',
          subjectId: chatbotId,
          action: 'set',
          before: { setAsideMicros: n(locked.set_aside_micros) },
          after: { setAsideMicros: next },
          note: 'budget set',
          actorUserId: actor,
        },
        manager,
      );
      const free = await this.freeBalanceOf(budget.accountId, manager);
      return {
        setAsideMicros: next,
        clamped: next !== target,
        warning:
          free < CREDITS.FREE_BALANCE_RESERVE_MICROS
            ? `This leaves $${usd(free).toFixed(2)} for building and testing, under the $${usd(CREDITS.FREE_BALANCE_RESERVE_MICROS).toFixed(2)} we suggest keeping.` // COPY: needs approval
            : null,
      };
    });
    return result;
  }

  /**
   * Going live (TF1 S2): customer replies are paid only from a chatbot's budget, so an assistant
   * that goes live with none answers nobody. When it has no open budget, set aside the starting
   * budget (as the cutover does) from the free balance, or whatever is free if that's less. Never
   * touches a budget the owner set, even one at $0 on purpose; nothing happens with credits off.
   * Returns what is set aside afterwards and whether this added it.
   */
  async ensureStartingBudget(
    chatbotId: string,
    actor: number | null,
  ): Promise<{ setAsideUsd: number; added: boolean } | null> {
    if (!(await this.switches()).enforcement) return null;
    const existing = await this.openBudget(chatbotId);
    if (existing) return { setAsideUsd: usd(existing.setAside), added: false };
    const accountId = await this.builderPayer({ chatbotId });
    if (!accountId) return { setAsideUsd: 0, added: false };
    const amount = Math.min(
      CREDITS.STARTING_BUDGET_MICROS,
      await this.freeBalanceOf(accountId),
    );
    if (amount <= 0) return { setAsideUsd: 0, added: false };
    const set = await this.setBudget(chatbotId, usd(amount), actor);
    return { setAsideUsd: usd(set.setAsideMicros), added: true };
  }

  /** Add to a chatbot's budget from the free balance. */
  async topUpBudget(
    chatbotId: string,
    amountUsd: number,
    actor: number | null,
  ) {
    if (!(Number(amountUsd) > 0))
      throw new BadRequestException('Top up by more than $0.');
    const budget = await this.openBudget(chatbotId);
    return this.setBudget(
      chatbotId,
      usd(budget?.setAside ?? 0) + Number(amountUsd),
      actor,
    );
  }

  /**
   * Archiving a chatbot: its budget stops, and whatever it had not spent goes back to the free
   * balance. What is still held for a run in flight is kept until that run settles or expires.
   */
  async archiveBudget(chatbotId: string): Promise<{ returnedMicros: number }> {
    return this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(
        `SELECT id, account_id, set_aside_micros, spent_micros, reserved_micros FROM chatbot_budgets
          WHERE chatbot_id = $1 AND archived_at IS NULL FOR UPDATE`,
        [chatbotId],
      );
      if (!row) return { returnedMicros: 0 };
      const keep = n(row.spent_micros) + n(row.reserved_micros);
      const back = Math.max(0, n(row.set_aside_micros) - keep);
      await manager.query(
        `UPDATE chatbot_budgets SET archived_at = now(), set_aside_micros = $2, updated_at = now() WHERE id = $1`,
        [row.id, keep],
      );
      await this.recomputeAccountSetAside(manager, row.account_id);
      return { returnedMicros: back };
    });
  }

  /**
   * Move a chatbot's budget to another account (ownership transfer). The receiving account sets
   * aside what was unspent from its own free balance, or the move is refused (Ally can grant first,
   * or do it by hand). The old account gets its unspent part back.
   */
  async transferBudget(
    chatbotId: string,
    to: { userId?: number; accountId?: string },
    actor: number | null,
  ): Promise<{
    fromAccountId: string;
    toAccountId: string;
    movedMicros: number;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(
        `SELECT id, account_id, set_aside_micros, spent_micros, reserved_micros FROM chatbot_budgets
          WHERE chatbot_id = $1 AND archived_at IS NULL FOR UPDATE`,
        [chatbotId],
      );
      if (!row)
        throw new NotFoundException('This chatbot has no budget to move.');
      const toAccountId =
        to.accountId ??
        (to.userId ? await this.accountFor(to.userId, manager) : null);
      if (!toAccountId)
        throw new BadRequestException('Name the receiving account or user.');
      if (toAccountId === row.account_id) {
        return { fromAccountId: row.account_id, toAccountId, movedMicros: 0 };
      }
      const keep = n(row.spent_micros) + n(row.reserved_micros);
      const unspent = Math.max(0, n(row.set_aside_micros) - keep);
      if (unspent > 0) {
        const moved = returned(
          await manager.query(
            `UPDATE billing_accounts SET set_aside_micros = set_aside_micros + $2, updated_at = now()
              WHERE id = $1 AND status = 'active'
                AND granted_micros - set_aside_micros - builder_spent_micros - reserved_micros >= $2
              RETURNING id`,
            [toAccountId, unspent],
          ),
        );
        if (!moved.length) {
          throw new ConflictException({
            errorCode: 'CREDITS_RECEIVER_FREE_BALANCE_TOO_LOW',
            message:
              "The receiving account's free balance is too low to take over this budget. Grant it credits first.",
          });
        }
      }
      await manager.query(
        `UPDATE chatbot_budgets SET archived_at = now(), set_aside_micros = $2, updated_at = now() WHERE id = $1`,
        [row.id, keep],
      );
      await this.recomputeAccountSetAside(manager, row.account_id);
      await manager.query(
        `INSERT INTO chatbot_budgets (account_id, chatbot_id, set_aside_micros, epoch) VALUES ($1, $2, $3, 1)`,
        [toAccountId, chatbotId, unspent],
      );
      await this.audit?.record(
        {
          subjectType: 'chatbot_budget',
          subjectId: chatbotId,
          action: 'transfer',
          before: { accountId: row.account_id },
          after: { accountId: toAccountId, movedMicros: unspent },
          note: 'budget moved between accounts',
          actorUserId: actor,
        },
        manager,
      );
      return {
        fromAccountId: row.account_id,
        toAccountId,
        movedMicros: unspent,
      };
    });
  }

  /**
   * Why this person cannot be removed from this chatbot yet, or null. The account paying for its
   * budget must hand it over first (Ledger edges: the creator cannot be removed until ownership and
   * budgets are transferred). For the member-removal code to call.
   */
  async removalBlockedReason(
    chatbotId: string,
    userId: number,
  ): Promise<string | null> {
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM chatbot_budgets b JOIN billing_accounts a ON a.id = b.account_id
        WHERE b.chatbot_id = $1 AND b.archived_at IS NULL AND a.owner_user_id = $2`,
      [chatbotId, userId],
    );
    return row
      ? "This person's credits pay for this chatbot's budget. Move the budget to another owner first."
      : null;
  }

  private async recomputeAccountSetAside(
    manager: EntityManager,
    accountId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE billing_accounts a SET set_aside_micros =
         coalesce((SELECT sum(set_aside_micros) FROM chatbot_budgets b WHERE b.account_id = a.id), 0),
         updated_at = now()
        WHERE a.id = $1`,
      [accountId],
    );
  }

  // ── reading ─────────────────────────────────────────────────────────

  async freeBalanceOf(
    accountId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<number> {
    const [row] = await manager.query(
      `SELECT granted_micros - set_aside_micros - builder_spent_micros - reserved_micros AS free
         FROM billing_accounts WHERE id = $1`,
      [accountId],
    );
    return n(row?.free);
  }

  /** What is left in a chatbot's budget for customers; 0 with no budget. */
  async budgetRemaining(chatbotId: string): Promise<number> {
    const budget = await this.openBudget(chatbotId);
    return budget ? budget.setAside - budget.spent - budget.reserved : 0;
  }

  /**
   * Memory and summary after a reply run only while the budget still has room (the reply that
   * empties it does not trigger them). Never throws: an unreadable ledger means no.
   */
  async budgetHasRoom(chatbotId: string): Promise<boolean> {
    try {
      if (!(await this.switches()).enforcement) return true;
      return (await this.budgetRemaining(chatbotId)) > 0;
    } catch {
      return false;
    }
  }

  /** The builder's Credits page (`GET v1/me/credits`). Dollars, never micros. */
  async creditsFor(userId: number) {
    const accountId = await this.findAccount(userId);
    if (!accountId) return this.emptyCredits();
    return this.accountView(accountId);
  }

  private emptyCredits() {
    return {
      accountId: null as string | null,
      status: 'none' as string,
      grantedUsd: 0,
      usedUsd: 0,
      builderSpentUsd: 0,
      customerSpentUsd: 0,
      setAsideUsd: 0,
      reservedUsd: 0,
      freeBalanceUsd: 0,
      reserveUsd: usd(CREDITS.FREE_BALANCE_RESERVE_MICROS),
      budgets: [] as Array<Record<string, unknown>>,
      spendByTask: [] as Array<Record<string, unknown>>,
      spendByKind: [] as Array<Record<string, unknown>>,
      spendByChatbot: [] as Array<Record<string, unknown>>,
      spendByDay: [] as Array<Record<string, unknown>>,
      grants: [] as Array<Record<string, unknown>>,
    };
  }

  /** One account, as the builder and Ally staff see it. */
  async accountView(accountId: string) {
    const [account] = await this.dataSource.query(
      `SELECT * FROM billing_accounts WHERE id = $1`,
      [accountId],
    );
    if (!account) throw new NotFoundException('No such account.');
    const budgets: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT b.chatbot_id, c.name, b.set_aside_micros, b.spent_micros, b.reserved_micros, b.archived_at
         FROM chatbot_budgets b LEFT JOIN chatbots c ON c.id = b.chatbot_id
        WHERE b.account_id = $1 ORDER BY b.archived_at IS NULL DESC, b.created_at`,
      [accountId],
    );
    // Every charge this account paid: the builder's own work (Try it, checkups, likely questions,
    // setup, site reading; funding 'free') and its customers' turns (funding 'budget'). A draft's
    // work counts under the chatbot it builds once it has one.
    const spend = (group: string) =>
      this.dataSource.query(
        `SELECT ${group} AS key,
                coalesce(sum(coalesce(e."costMicros", e."chargedMicros")), 0) AS cost
           FROM usage_events e
           LEFT JOIN bot_drafts d ON d.id = e."draftId"
          WHERE e."payerAccountId" = $1 AND e."createdAt" >= now() - interval '90 days'
          GROUP BY 1 ORDER BY 1`,
        [accountId],
      ) as Promise<Array<{ key: string | null; cost: string }>>;
    const [byTask, byKind, byChatbot, byDay] = await Promise.all([
      spend(`coalesce(e.task, e.kind)`),
      spend(`e.kind`),
      spend(`coalesce(e."chatbotId", d.chatbot_id)::text`),
      spend(`to_char(e."createdAt", 'YYYY-MM-DD')`),
    ]);
    // Names for every chatbot spent on, with or without a budget (a builder testing before
    // setting one aside still sees which chatbot it was).
    const spentOn = byChatbot
      .map((r) => r.key)
      .filter((key): key is string => Boolean(key));
    const named: Array<{ id: string; name: string }> = spentOn.length
      ? await this.dataSource.query(
          `SELECT id::text AS id, name FROM chatbots WHERE id = ANY($1::uuid[])`,
          [spentOn],
        )
      : [];
    const names = new Map<string, string | null>([
      ...budgets.map((b) => [b.chatbot_id, b.name] as [string, string | null]),
      ...named.map((c) => [c.id, c.name] as [string, string | null]),
    ]);
    const grants: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT g.id, g.amount_micros, g.kind, g.note, g.created_at, g.granted_by, u.name AS granted_by_name
         FROM credit_grants g LEFT JOIN users u ON u.id = g.granted_by
        WHERE g.account_id = $1 ORDER BY g.created_at DESC`,
      [accountId],
    );
    const customerSpent = budgets.reduce(
      (sum, b) => sum + n(b.spent_micros),
      0,
    );
    const free =
      n(account.granted_micros) -
      n(account.set_aside_micros) -
      n(account.builder_spent_micros) -
      n(account.reserved_micros);
    return {
      accountId,
      ownerUserId: account.owner_user_id as number,
      status: account.status as string,
      grantedUsd: usd(account.granted_micros),
      usedUsd: usd(n(account.builder_spent_micros) + customerSpent),
      builderSpentUsd: usd(account.builder_spent_micros),
      customerSpentUsd: usd(customerSpent),
      setAsideUsd: usd(account.set_aside_micros),
      reservedUsd: usd(account.reserved_micros),
      freeBalanceUsd: usd(free),
      reserveUsd: usd(CREDITS.FREE_BALANCE_RESERVE_MICROS),
      budgets: budgets.map((b) => ({
        chatbotId: b.chatbot_id as string,
        name: (b.name as string) ?? null,
        setAsideUsd: usd(b.set_aside_micros),
        spentUsd: usd(b.spent_micros),
        remainingUsd: usd(
          Math.max(
            0,
            n(b.set_aside_micros) - n(b.spent_micros) - n(b.reserved_micros),
          ),
        ),
        archived: Boolean(b.archived_at),
      })),
      spendByTask: byTask.map((r) => ({
        task: r.key ?? 'other',
        costUsd: usd(r.cost),
      })),
      // By usage kind (try_it, checkup, setup, customer_reply…): what the work was for.
      spendByKind: byKind.map((r) => ({
        kind: r.key ?? 'other',
        costUsd: usd(r.cost),
      })),
      spendByChatbot: byChatbot.map((r) => ({
        chatbotId: r.key,
        name: r.key ? (names.get(r.key) ?? null) : null,
        costUsd: usd(r.cost),
      })),
      spendByDay: byDay.map((r) => ({ day: r.key, costUsd: usd(r.cost) })),
      grants: grants.map((g) => ({
        id: g.id as string,
        kind: g.kind as string,
        amountUsd: usd(g.amount_micros),
        note: g.note as string,
        at: g.created_at as Date,
        grantedBy: (g.granted_by_name as string) ?? null,
      })),
    };
  }

  /** A chatbot's budget panel. */
  async budgetView(chatbotId: string) {
    const budget = await this.openBudget(chatbotId);
    const [bot] = await this.dataSource.query(
      `SELECT settings->'userLimits' AS limits FROM chatbots WHERE id = $1`,
      [chatbotId],
    );
    const limits = (bot?.limits ?? {}) as UserLimits;
    const free = budget ? await this.freeBalanceOf(budget.accountId) : null;
    return {
      chatbotId,
      hasBudget: Boolean(budget),
      setAsideUsd: usd(budget?.setAside ?? 0),
      spentUsd: usd(budget?.spent ?? 0),
      reservedUsd: usd(budget?.reserved ?? 0),
      remainingUsd: usd(
        budget
          ? Math.max(0, budget.setAside - budget.spent - budget.reserved)
          : 0,
      ),
      freeBalanceUsd: free === null ? null : usd(free),
      reserveUsd: usd(CREDITS.FREE_BALANCE_RESERVE_MICROS),
      userLimits: limitsInUsd(limits),
    };
  }

  /** Ally admin: every account with its balance. */
  async listAccounts() {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT a.*, u.name, u.email FROM billing_accounts a LEFT JOIN users u ON u.id = a.owner_user_id
        ORDER BY a.created_at DESC LIMIT 1000`,
    );
    return rows.map((a) => ({
      accountId: a.id as string,
      ownerUserId: a.owner_user_id as number,
      name: (a.name as string) ?? null,
      email: (a.email as string) ?? null,
      status: a.status as string,
      grantedUsd: usd(a.granted_micros),
      setAsideUsd: usd(a.set_aside_micros),
      builderSpentUsd: usd(a.builder_spent_micros),
      freeBalanceUsd: usd(
        n(a.granted_micros) -
          n(a.set_aside_micros) -
          n(a.builder_spent_micros) -
          n(a.reserved_micros),
      ),
    }));
  }

  /** Per-user dollar limits on a chatbot: stored on its settings (`userLimits`, micros). */
  async setUserLimits(
    chatbotId: string,
    input: {
      dailyUsd?: number | null;
      weeklyUsd?: number | null;
      monthlyUsd?: number | null;
    },
  ) {
    const micros = (value: number | null | undefined) => {
      if (value === null || value === undefined || (value as unknown) === '')
        return null;
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0) {
        throw new BadRequestException(
          'A limit is $0 or more, or empty for none.',
        );
      }
      return usdToMicros(v);
    };
    const limits: UserLimits = {
      dailyMicros: micros(input.dailyUsd),
      weeklyMicros: micros(input.weeklyUsd),
      monthlyMicros: micros(input.monthlyUsd),
    };
    await this.dataSource.query(
      `UPDATE chatbots SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('userLimits', $2::jsonb)
        WHERE id = $1`,
      [chatbotId, JSON.stringify(limits)],
    );
    return limitsInUsd(limits);
  }

  // ── the nightly rebuild ─────────────────────────────────────────────

  /**
   * Set every counter from its rows: grants, budgets, settled usage and open reservations, and
   * the person-period spend of the last 40 days in each chatbot's zone. Usage priced after it was
   * recorded (a model added later) replaces its fallback charge here.
   */
  async rebuild(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`
        UPDATE billing_accounts a SET
          granted_micros = coalesce((SELECT sum(amount_micros) FROM credit_grants g WHERE g.account_id = a.id), 0),
          set_aside_micros = coalesce((SELECT sum(set_aside_micros) FROM chatbot_budgets b WHERE b.account_id = a.id), 0),
          builder_spent_micros = coalesce((SELECT sum(coalesce(e."costMicros", e."chargedMicros")) FROM usage_events e
                                            WHERE e."payerAccountId" = a.id AND e.funding = 'free'), 0),
          reserved_micros = coalesce((SELECT sum(greatest(0, r.reserved_micros - r.consumed_micros)) FROM credit_reservations r
                                       WHERE r.account_id = a.id AND r.funding = 'free' AND r.state = 'reserved'), 0),
          updated_at = now()`);
      await manager.query(`
        UPDATE chatbot_budgets b SET
          spent_micros = coalesce((SELECT sum(coalesce(e."costMicros", e."chargedMicros")) FROM usage_events e
                                    WHERE e."chatbotId" = b.chatbot_id AND e."payerAccountId" = b.account_id
                                      AND e.funding = 'budget' AND e."recordedAt" >= b.created_at), 0),
          reserved_micros = coalesce((SELECT sum(greatest(0, r.reserved_micros - r.consumed_micros)) FROM credit_reservations r
                                       WHERE r.chatbot_id = b.chatbot_id AND r.account_id = b.account_id
                                         AND r.funding = 'budget' AND r.state = 'reserved'), 0),
          updated_at = now()
        WHERE b.archived_at IS NULL`);
      for (const [kind, trunc] of [
        ['day', 'day'],
        ['week', 'week'],
        ['month', 'month'],
      ] as const) {
        await manager.query(
          `INSERT INTO end_person_spend (end_person_id, period_kind, period_start, chatbot_id, spent_micros)
           SELECT e."endPersonId", $1,
                  date_trunc('${trunc}', (e."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE coalesce(c.settings->>'timeZone', 'Asia/Kolkata'))::date,
                  e."chatbotId", sum(coalesce(e."costMicros", e."chargedMicros"))
             FROM usage_events e JOIN chatbots c ON c.id = e."chatbotId"
            WHERE e."endPersonId" IS NOT NULL AND e."createdAt" >= now() - interval '40 days'
            GROUP BY 1, 3, 4
           ON CONFLICT (end_person_id, period_kind, period_start)
             DO UPDATE SET spent_micros = EXCLUDED.spent_micros, updated_at = now()`,
          [kind],
        );
      }
    });
  }
}

/**
 * `ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF`: `true`/`false` when set; otherwise on in production only.
 */
export function blockOnFeedOff(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return env.NODE_ENV === 'production';
}

function returned(result: unknown): unknown[] {
  // `manager.query` on an UPDATE … RETURNING gives [rows, count] on postgres.
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0])
  ) {
    return result[0];
  }
  return Array.isArray(result) ? result : [];
}

export function limitsInUsd(limits: UserLimits | null | undefined) {
  const v = (m: number | null | undefined) =>
    m === null || m === undefined ? null : microsToUsd(Number(m));
  return {
    dailyUsd: v(limits?.dailyMicros),
    weeklyUsd: v(limits?.weeklyMicros),
    monthlyUsd: v(limits?.monthlyMicros),
  };
}
