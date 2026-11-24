import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SESService } from 'src/aws/service/ses.service';
import { LoggerService } from 'src/logger/logger.service';
import { UsageContext } from '../context/usage-context';
import {
  CounterSubject,
  SeatKind,
  SeatStatus,
  SubscriptionStatus,
  UsageChannel,
  UsageKind,
} from '../enum/billing.enum';
import { PlanService, dayString, periodFor } from './plan.service';
import { SpendCapService } from './spend-cap.service';
import { randomUUID } from 'crypto';
import { CREDITS, runEstimateMicros } from '../constants/credits.constants';
import { EndPersonService } from './end-person.service';
import { OWNER_CREDITS_MESSAGES, creditPauseKind } from '../util/credit-pause';
import {
  CreditBlockReason,
  LedgerService,
  PausedJob,
  UserLimits,
} from './ledger.service';

/** Why a run must not start (matches the engine's LimitReason). */
export type LimitVerdict =
  | 'customers'
  | 'no_seat'
  | 'seat_messages'
  | 'owner_cap'
  | 'owner_runs'
  /** Stage 6: a customer's turn the ledger refused (OUT_OF_CREDITS: no payer, budget or limits). */
  | 'out_of_credits'
  /** Stage 6: the owner's own testing with no free balance left. */
  | 'owner_credits';

/** Who is messaging: a public/WhatsApp customer, an invited person (a seat), or the owner's team. */
export type Audience = 'customer' | 'seat' | 'owner';

export interface TurnLimitInput {
  chatbotId: string;
  creatorUserId: number | null | undefined;
  /** The conversation (or, without one, the sender) for "a new conversation after 24 hours". */
  conversationKey: string | null | undefined;
  context: UsageContext | undefined;
  /** Stage 6: who is messaging, for the end person's per-user limits. */
  sender?: {
    phone?: string | null;
    email?: string | null;
    label?: string | null;
  };
  /** Stage 6: the chatbot's per-user dollar limits (`settings.userLimits`). */
  userLimits?: UserLimits | null;
  /** Stage 6: the chatbot's time zone, for the limits' day, week and month. */
  timeZone?: string | null;
}

/** The outcome of a background job's credits gate (site reading, re-indexing). */
export type BackgroundGate =
  | { ok: true; accountId: string | null }
  | { ok: false; paused: boolean; reason: CreditBlockReason | 'plan_limit' };

const hasLimit = (limits: UserLimits | null | undefined) =>
  Boolean(
    limits &&
    [limits.dailyMicros, limits.weeklyMicros, limits.monthlyMicros].some(
      (v) => v !== null && v !== undefined,
    ),
  );

const GAP_MS = 24 * 3_600_000;

/** Owner-side work, counted once per run (CR1 C2). */
export type OwnerRunKind =
  | 'setup'
  | 'site_reading'
  | 'checkup'
  | 'change_by_chat'
  | 'indexing'
  | 'try_it';

/**
 * Every limit, checked before a run starts (CR1 enforcement):
 *   - the creator's monthly cost cap, if they have one (Ally's guard; owners never see the amount);
 *   - an invited person's seat (and its messages this month);
 *   - an assistant's monthly customer conversations (public visitors and WhatsApp numbers);
 *   - the creator's monthly owner-side runs (setup, site reading, checkups, change by chat,
 *     re-indexing, Try it).
 *
 * Counting is synchronous and idempotent on (run id, kind): the same message or request counted
 * twice is counted once. The crisis check is never blocked: the engine runs it before answering a
 * limited message, and its reply goes out. A run already started finishes.
 *
 * Every check fails OPEN on a database error: a counting outage must not silence an assistant.
 */
@Injectable()
export class LimitsService {
  private readonly logger = LoggerService.getInstance(LimitsService.name);
  /** When each chatbot (or builder) last passed the credits gate: the DB-down grace. */
  private readonly lastPassed = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly plans: PlanService,
    private readonly spend: SpendCapService,
    @Optional() private readonly ses?: SESService,
    @Optional() private readonly ledger?: LedgerService,
    @Optional() private readonly persons?: EndPersonService,
  ) {}

  /** Credit enforcement is on (the kill switch), and the ledger is wired. */
  private async creditsOn(): Promise<boolean> {
    return Boolean(this.ledger && (await this.ledger.switches()).enforcement);
  }

  /**
   * The engine's check for one message, before any model call. Null: answer it.
   *
   * Stage 6, with credit enforcement on: the turn's money is RESERVED here, atomically, from the
   * chatbot's budget (a customer, including the end person's daily/weekly/monthly limits) or the
   * builder's free balance (the owner testing, R2), and the payer is stamped on the run's usage
   * context. No payer, an empty budget, a person over a limit, or a stopped usage feed: blocked
   * (OUT_OF_CREDITS). A database failure fails CLOSED after a short grace.
   *
   * With enforcement switched off, the CR1 limits below run exactly as before.
   */
  async checkTurn(input: TurnLimitInput): Promise<LimitVerdict | null> {
    // Stage 9: Ally pays for its own safety-pack release suite; nothing is reserved or counted.
    if (input.context?.allyPaidKind) return null;
    if (await this.creditsOn().catch(() => true)) {
      return this.checkCredits(input);
    }
    return this.legacyCheckTurn(input);
  }

  private async checkCredits(
    input: TurnLimitInput,
  ): Promise<LimitVerdict | null> {
    const context = input.context;
    if (!context) return null; // no run: nothing will be called
    const owner = audienceOf(context) === 'owner';
    const blocked: LimitVerdict = owner ? 'owner_credits' : 'out_of_credits';
    const graceKey = input.chatbotId || String(input.creatorUserId ?? '');
    try {
      const ledger = this.ledger!;
      if (await ledger.feedBlocksSpend()) {
        this.logger.warn(
          `Credits: usage feed stopped; refusing a run on ${input.chatbotId} (feed_off)`,
        );
        // The builder's own test pane names the real reason; a customer still gets the fixed
        // notification, whatever the reason.
        context.creditBlockReason = 'feed_off';
        return blocked;
      }
      let endPersonId: string | null = null;
      if (!owner && this.persons && input.sender) {
        endPersonId = await this.persons.find(input.chatbotId, input.sender);
        // A person is only created when the chatbot has per-user limits to count against.
        if (!endPersonId && hasLimit(input.userLimits)) {
          endPersonId = await this.persons.resolve(input.chatbotId, {
            ...input.sender,
            display: input.sender.label ?? null,
          });
        }
      }
      const runId = context.runId ?? randomUUID();
      const result = await ledger.reserve({
        runId,
        funding: owner ? 'free' : 'budget',
        estimateMicros: runEstimateMicros(context.runKind),
        chatbotId: input.chatbotId,
        draftId: context.draftId ?? null,
        creatorUserId: input.creatorUserId ?? null,
        endPersonId,
        userLimits: input.userLimits ?? null,
        timeZone: input.timeZone ?? null,
      });
      if (!result.ok) {
        this.logger.info(
          `Credits: run on chatbot ${input.chatbotId} refused (${result.reason})`,
        );
        context.creditBlockReason = result.reason;
        return blocked;
      }
      // The payer is stamped on the run when it starts (the context object is the run's own).
      context.runId = runId;
      context.payerAccountId = result.accountId;
      context.endPersonId = endPersonId;
      // Let through with the feed stopped (not blocking here): its cost goes unrecorded.
      if (!(await ledger.feedHealthy().catch(() => true))) {
        context.costUnrecorded = true;
      }
      this.lastPassed.set(graceKey, Date.now());
      return null;
    } catch (error) {
      const passed = this.lastPassed.get(graceKey);
      const inGrace =
        passed !== undefined && Date.now() - passed < CREDITS.DB_DOWN_GRACE_MS;
      this.logger.warn(
        `Credits check failed for chatbot ${input.chatbotId} (${inGrace ? 'within grace, answering' : 'failing closed'}): ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      if (!inGrace) context.creditBlockReason = 'ledger_unavailable';
      return inGrace ? null : blocked;
    }
  }

  /**
   * Background AI work for a builder (site reading, re-indexing): may it start? With credits on,
   * only while the paying account has a free balance and the feed records; otherwise the job is
   * PAUSED (kept in `credit_paused_jobs`, resumed by the ledger once credits exist), never failed.
   * With credits off, the CR1 owner-run count as before (a refusal is not paused).
   */
  async backgroundGate(input: {
    kind: string;
    subjectId: string;
    creatorUserId: number | null | undefined;
    chatbotId?: string | null;
    draftId?: string | null;
    runKey: string;
    ownerRunKind: OwnerRunKind;
    payload: Record<string, unknown>;
  }): Promise<BackgroundGate> {
    if (!(await this.creditsOn().catch(() => true))) {
      try {
        await this.assertOwnerRun(
          input.creatorUserId,
          input.runKey,
          input.ownerRunKind,
        );
        return { ok: true, accountId: null };
      } catch {
        return { ok: false, paused: false, reason: 'plan_limit' };
      }
    }
    const ledger = this.ledger!;
    let accountId: string | null = null;
    let reason: CreditBlockReason | null = null;
    try {
      accountId = await ledger.builderPayer({
        chatbotId: input.chatbotId,
        draftId: input.draftId,
        creatorUserId: input.creatorUserId,
      });
      if (!accountId) reason = 'no_payer';
      else if (await ledger.feedBlocksSpend()) reason = 'feed_off';
      else if (!((await ledger.freeBalanceOf(accountId)) > 0))
        reason = 'free_balance_empty';
    } catch {
      reason = 'ledger_unavailable';
    }
    if (!reason) return { ok: true, accountId };
    await ledger
      .pauseJob({
        kind: input.kind,
        subjectId: input.subjectId,
        accountId,
        ownerUserId: input.creatorUserId ?? null,
        reason,
        payload: input.payload,
      })
      .catch((error) =>
        this.logger.warn(
          `Could not pause ${input.kind} for ${input.subjectId}: ${error instanceof Error ? error.message : ''}`,
        ),
      );
    this.logger.info(
      `Credits: ${input.kind} for ${input.subjectId} paused (${reason})`,
    );
    return { ok: false, paused: true, reason };
  }

  /** Resume a paused background job kind once its builder has credits again (the ledger's sweep). */
  onResume(kind: string, handler: (job: PausedJob) => Promise<void>): void {
    this.ledger?.registerResumer(kind, handler);
  }

  /** A resume step for paused work kept outside the ledger's jobs (see `resumeAllPaused`). */
  onSweep(name: string, sweep: () => Promise<number>): void {
    this.ledger?.registerSweeper(name, sweep);
  }

  /**
   * Give a turn's reservation back at once: its reply needed no model (a keyword reply or a
   * refusal). Only a run this gate stamped a payer on holds anything.
   */
  async releaseTurn(context: UsageContext | undefined): Promise<void> {
    if (!this.ledger || !context?.runId || !context.payerAccountId) return;
    await this.ledger.release(context.runId);
  }

  /** The CR1 check (plans, seats, the spend cap): what runs with credit enforcement off. */
  async legacyCheckTurn(input: TurnLimitInput): Promise<LimitVerdict | null> {
    const context = input.context;
    const creator = input.creatorUserId ?? null;
    if (!context || !creator) return null;
    try {
      const audience = audienceOf(context);
      const creatorPlan = await this.plans.planOf(creator);
      const capped = await this.spend.isOverCap(creator, creatorPlan);

      if (audience === 'owner') {
        if (capped) return 'owner_cap';
        // A checkup counts once when it starts, not per question.
        if (context.runKind === UsageKind.TRY_IT) {
          const ok = await this.countOwnerRun(
            creator,
            context.runId ?? '',
            'try_it',
          );
          if (!ok) return 'owner_runs';
        }
        return null;
      }

      const { plan, subscription } = creatorPlan;

      if (audience === 'seat' && plan.seatsRequired) {
        const seat = await this.plans.seatFor(
          input.chatbotId,
          context.seatEmail,
        );
        const usable =
          seat &&
          seat.status !== SeatStatus.LAPSED &&
          !(
            seat.kind === SeatKind.INCLUDED &&
            subscription?.status === SubscriptionStatus.CANCELLED
          );
        if (!usable) return 'no_seat';
        if (capped) return 'customers';
        const ok = await this.count(
          CounterSubject.SEAT,
          seat.id,
          periodFor(dayString(seat.startDate)),
          seat.messagesPerMonth,
          context.runId ?? '',
          'seat_message',
          creator,
        );
        return ok ? null : 'seat_messages';
      }

      if (capped) return 'customers';
      if (audience === 'seat') return null; // internal plan: invited people need no seat
      return (await this.countCustomerConversation(
        input,
        plan.customerConversations,
        creator,
      ))
        ? null
        : 'customers';
    } catch (error) {
      this.logger.warn(
        `Limit check failed open for chatbot ${input.chatbotId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Owner-side work outside a chat (setup, site reading, checkups, change by chat, re-indexing):
   * throws 402-style Forbidden with the owner's message before any AI call.
   */
  async assertOwnerRun(
    creatorUserId: number | null | undefined,
    runKey: string,
    kind: OwnerRunKind,
  ): Promise<void> {
    if (await this.creditsOn().catch(() => true)) {
      return this.assertOwnerCredits(creatorUserId, kind);
    }
    if (!creatorUserId) return;
    let verdict: LimitVerdict | null = null;
    try {
      if (await this.spend.isOverCap(creatorUserId)) verdict = 'owner_cap';
      else if (!(await this.countOwnerRun(creatorUserId, runKey, kind)))
        verdict = 'owner_runs';
    } catch (error) {
      this.logger.warn(
        `Owner-run check failed open: ${error instanceof Error ? error.message : ''}`,
      );
      return;
    }
    if (verdict === 'owner_cap') {
      throw new ForbiddenException({
        message:
          "Your account has reached this month's usage limit. Ask Ally to raise it.",
        errorCode: 'USAGE_CAP_REACHED',
      });
    }
    if (verdict === 'owner_runs') {
      throw new ForbiddenException({
        message:
          "Your plan's monthly limit for setup and checkups is used up. Ask Ally to upgrade.",
        errorCode: 'PLAN_OWNER_RUNS_USED_UP',
      });
    }
  }

  /**
   * Stage 6: owner-side work is paid from the builder's free balance (R2). Refused with
   * `CREDITS_REQUIRED` before any AI call when there is none, no payer, or the feed is stopped.
   */
  private async assertOwnerCredits(
    creatorUserId: number | null | undefined,
    kind: OwnerRunKind,
  ): Promise<void> {
    let reason: CreditBlockReason | null = null;
    const graceKey = `owner:${creatorUserId ?? ''}`;
    try {
      const ledger = this.ledger!;
      const accountId = creatorUserId
        ? await ledger.accountFor(creatorUserId)
        : null;
      if (!accountId) reason = 'no_payer';
      else if (await ledger.feedBlocksSpend()) reason = 'feed_off';
      else if (!((await ledger.freeBalanceOf(accountId)) > 0))
        reason = 'free_balance_empty';
      if (!reason) this.lastPassed.set(graceKey, Date.now());
    } catch {
      const passed = this.lastPassed.get(graceKey);
      if (
        passed !== undefined &&
        Date.now() - passed < CREDITS.DB_DOWN_GRACE_MS
      )
        return;
      reason = 'ledger_unavailable';
    }
    if (!reason) return;
    this.logger.info(
      `Credits: owner ${kind} refused for user ${creatorUserId} (${reason})`,
    );
    throw new HttpException(
      {
        errorCode: 'credits_required',
        reason,
        // Never "out of credits" for a reason that isn't (a stopped feed, no billing account).
        message: OWNER_CREDITS_MESSAGES[creditPauseKind(reason)],
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  /** Counts one owner-side run; false when the month's runs are used up. */
  async countOwnerRun(
    creatorUserId: number,
    runKey: string,
    kind: OwnerRunKind,
  ): Promise<boolean> {
    const { plan, anchor } = await this.plans.planOf(creatorUserId);
    return this.count(
      CounterSubject.OWNER_RUNS,
      String(creatorUserId),
      periodFor(anchor),
      plan.ownerRuns,
      runKey || `${kind}:${Date.now()}:${Math.random()}`,
      `owner_run:${kind}`,
      creatorUserId,
    );
  }

  /**
   * A customer message starts a new conversation when the last one in it is over 24 hours old.
   * Only a new conversation counts. Its activity is recorded only when it may go ahead, so a
   * refused first message doesn't make the next one "the same conversation".
   */
  private async countCustomerConversation(
    input: TurnLimitInput,
    allowance: number | null,
    creator: number,
  ): Promise<boolean> {
    const key = (input.conversationKey ?? '').slice(0, 160);
    if (!key) return true;
    const now = new Date();
    const [activity] = await this.dataSource.query(
      `SELECT "lastMessageAt" FROM customer_activity WHERE "chatbotId" = $1 AND "conversationKey" = $2`,
      [input.chatbotId, key],
    );
    const isNew =
      !activity ||
      now.getTime() - new Date(activity.lastMessageAt).getTime() > GAP_MS;
    if (isNew) {
      const { anchor } = await this.plans.planOf(creator);
      const ok = await this.count(
        CounterSubject.CUSTOMERS,
        input.chatbotId,
        periodFor(anchor),
        allowance,
        input.context?.runId ?? `${key}:${now.getTime()}`,
        'customer_conversation',
        creator,
      );
      if (!ok) return false;
    }
    await this.dataSource.query(
      `INSERT INTO customer_activity ("chatbotId", "conversationKey", "lastMessageAt") VALUES ($1, $2, $3)
       ON CONFLICT ("chatbotId", "conversationKey") DO UPDATE SET "lastMessageAt" = EXCLUDED."lastMessageAt"`,
      [input.chatbotId, key, now],
    );
    return true;
  }

  /**
   * Add one to a counter unless it's at its limit. Idempotent on (runId, kind): a second call for
   * the same run answers as the first did. The counter row is locked for the check and the add.
   */
  async count(
    subjectType: CounterSubject,
    subjectId: string,
    period: { start: string; end: string },
    limit: number | null,
    runId: string,
    kind: string,
    creatorUserId: number | null,
  ): Promise<boolean> {
    const crossed = await this.dataSource.transaction(async (manager) => {
      const [counter] = await manager.query(
        `INSERT INTO usage_counters ("subjectType", "subjectId", "periodStart", "periodEnd", "limitAtTime")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("subjectType", "subjectId", "periodStart")
           DO UPDATE SET "limitAtTime" = EXCLUDED."limitAtTime", "updatedAt" = now()
         RETURNING id`,
        [subjectType, subjectId, period.start, period.end, limit],
      );
      const [locked] = await manager.query(
        `SELECT id, count, "limitAtTime", "alerted80At", "alerted100At" FROM usage_counters WHERE id = $1 FOR UPDATE`,
        [counter.id],
      );
      const [hit] = await manager.query(
        `SELECT "counterId" FROM usage_counter_hits WHERE "runId" = $1 AND kind = $2`,
        [runId, kind],
      );
      if (hit) return { allowed: true, threshold: null as null | 80 | 100 };
      if (limit !== null && locked.count >= limit) {
        return {
          allowed: false,
          threshold: await this.markThreshold(
            manager,
            locked,
            locked.count,
            limit,
          ),
        };
      }
      await manager.query(
        `INSERT INTO usage_counter_hits ("runId", kind, "counterId") VALUES ($1, $2, $3)`,
        [runId, kind, counter.id],
      );
      const next = Number(locked.count) + 1;
      await manager.query(
        `UPDATE usage_counters SET count = $2 WHERE id = $1`,
        [counter.id, next],
      );
      return {
        allowed: true,
        threshold:
          limit !== null
            ? await this.markThreshold(manager, locked, next, limit)
            : null,
      };
    });
    if (crossed.threshold && creatorUserId) {
      void this.notifyCreator(
        creatorUserId,
        subjectType,
        crossed.threshold,
      ).catch(() => undefined);
    }
    return crossed.allowed;
  }

  /** Marks 80% / 100% once per counter period; returns the one just crossed. */
  private async markThreshold(
    manager: EntityManager,
    counter: {
      id: string;
      alerted80At: Date | null;
      alerted100At: Date | null;
    },
    count: number,
    limit: number,
  ): Promise<80 | 100 | null> {
    if (limit <= 0) return null;
    if (count >= limit && !counter.alerted100At) {
      await manager.query(
        `UPDATE usage_counters SET "alerted100At" = now(), "alerted80At" = coalesce("alerted80At", now()) WHERE id = $1`,
        [counter.id],
      );
      return 100;
    }
    if (count >= Math.ceil(limit * 0.8) && !counter.alerted80At) {
      await manager.query(
        `UPDATE usage_counters SET "alerted80At" = now() WHERE id = $1`,
        [counter.id],
      );
      return 80;
    }
    return null;
  }

  /** The publisher hears at 80% and 100% of a limit, once each per period. No numbers in dollars. */
  private async notifyCreator(
    userId: number,
    subject: CounterSubject,
    pct: 80 | 100,
  ): Promise<void> {
    if (!this.ses) return;
    const [user] = await this.dataSource.query(
      `SELECT email, name FROM users WHERE id = $1`,
      [userId],
    );
    if (!user?.email) return;
    const what =
      subject === CounterSubject.CUSTOMERS
        ? 'customer conversations on one of your assistants'
        : subject === CounterSubject.SEAT
          ? 'messages on one of your seats'
          : 'setup and checkup runs';
    const body =
      pct === 100
        ? `You've used all of this month's ${what}. Some messages will get a short "not available" reply until it resets. Crisis replies always go out. Ask Ally to upgrade, or see Plan and usage.`
        : `You've used 80% of this month's ${what}. See Plan and usage in your Ally account.`;
    await this.ses.sendEmail({
      to: user.email,
      subject:
        pct === 100
          ? `Your Ally plan: this month's ${subject === CounterSubject.OWNER_RUNS ? 'runs are' : 'limit is'} used up`
          : 'Your Ally plan: 80% used',
      body,
      purpose: 'billing-limit-alert',
      maskRecipientsInLog: true,
      alertOnFailure: false,
    });
  }
}

/** Who a usage context's message is from. */
export function audienceOf(context: UsageContext): Audience {
  if (context.audience) return context.audience;
  return context.channel === UsageChannel.OWNER ? 'owner' : 'customer';
}
