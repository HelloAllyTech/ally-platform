import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
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
import { TokenService } from './token.service';

/** Why a run must not start (matches the engine's LimitReason). */
export type LimitVerdict =
  | 'customers'
  | 'no_seat'
  | 'seat_messages'
  | 'owner_tokens'
  | 'owner_runs';

/** Who is messaging: a public/WhatsApp customer, an invited person (a seat), or the owner's team. */
export type Audience = 'customer' | 'seat' | 'owner';

export interface TurnLimitInput {
  chatbotId: string;
  creatorUserId: number | null | undefined;
  /** The conversation (or, without one, the sender) for "a new conversation after 24 hours". */
  conversationKey: string | null | undefined;
  context: UsageContext | undefined;
}

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
 *   - the creator's tokens, if they have an allowance;
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

  constructor(
    private readonly dataSource: DataSource,
    private readonly plans: PlanService,
    private readonly tokens: TokenService,
    @Optional() private readonly ses?: SESService,
  ) {}

  /** The engine's check for one message. Null: answer it. */
  async checkTurn(input: TurnLimitInput): Promise<LimitVerdict | null> {
    const context = input.context;
    const creator = input.creatorUserId ?? null;
    if (!context || !creator) return null;
    try {
      const audience = audienceOf(context);
      const tokensOut = await this.tokens.isUsedUp(creator);

      if (audience === 'owner') {
        if (tokensOut) return 'owner_tokens';
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

      const { plan, subscription } = await this.plans.planOf(creator);

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
        if (tokensOut) return 'customers';
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

      if (tokensOut) return 'customers';
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
    if (!creatorUserId) return;
    let verdict: LimitVerdict | null = null;
    try {
      if (await this.tokens.isUsedUp(creatorUserId)) verdict = 'owner_tokens';
      else if (!(await this.countOwnerRun(creatorUserId, runKey, kind)))
        verdict = 'owner_runs';
    } catch (error) {
      this.logger.warn(
        `Owner-run check failed open: ${error instanceof Error ? error.message : ''}`,
      );
      return;
    }
    if (verdict === 'owner_tokens') {
      throw new ForbiddenException({
        message: 'Your tokens are used up. Ask Ally to add more.',
        errorCode: 'TOKENS_USED_UP',
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
