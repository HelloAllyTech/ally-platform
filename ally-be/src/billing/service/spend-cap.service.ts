import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SESService } from 'src/aws/service/ses.service';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { Plan } from '../entity/plan.entity';
import { Subscription } from '../entity/subscription.entity';
import { UsageEvent } from '../entity/usage-event.entity';
import { CostAlertKind, SubscriptionStatus } from '../enum/billing.enum';
import { microsToUsd, usdToMicros } from '../util/pricing.util';
import { BillingAuditService } from './billing-audit.service';
import { CostAlertService } from './cost-alert.service';
import { CreatorPlan, PlanService, periodFor } from './plan.service';
import { UsageEventListener, UsageEventService } from './usage-event.service';

/** Where a creator's cap comes from. */
export type CapSource = 'plan' | 'own' | 'off' | 'none';

export interface SpendState {
  usedMicros: number;
  /** Null: not capped. */
  capMicros: number | null;
  capSource: CapSource;
  period: { start: string; end: string };
}

const usd = (micros: number) => `$${microsToUsd(micros).toFixed(2)}`;

/** A creator's cap: their own, else their plan's; null when there is none or it is switched off. */
export function capOf(
  plan: Pick<Plan, 'costCapMicros'>,
  subscription: Pick<Subscription, 'costCapMicros' | 'costCapOff'> | null,
): { capMicros: number | null; capSource: CapSource } {
  if (subscription?.costCapOff) return { capMicros: null, capSource: 'off' };
  if (
    subscription?.costCapMicros !== null &&
    subscription?.costCapMicros !== undefined
  ) {
    return { capMicros: Number(subscription.costCapMicros), capSource: 'own' };
  }
  if (plan.costCapMicros !== null && plan.costCapMicros !== undefined) {
    return { capMicros: Number(plan.costCapMicros), capSource: 'plan' };
  }
  return { capMicros: null, capSource: 'none' };
}

/**
 * The spend cap: the most a creator's assistants may cost Ally in one plan period, in dollars.
 *
 * It replaces token allowances. The plan's own limits (conversations, seats, setup runs) are what
 * owners plan around; this is Ally's guard underneath them, sized so it is only reached when
 * something has gone wrong. Owners see it on Plan and usage as their monthly usage allowance.
 *
 * What counts is every priced usage event attributed to the creator, WhatsApp fees included, added
 * in the same transaction the event is recorded in. A redelivered event is never inserted twice,
 * so it is never added twice. Ally hears at 80% and at 100%; the owner hears at 100%, when their
 * assistants stop answering.
 */
@Injectable()
export class SpendCapService implements UsageEventListener, OnModuleInit {
  private readonly logger = LoggerService.getInstance(SpendCapService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly plans: PlanService,
    private readonly audit: BillingAuditService,
    private readonly usage: UsageEventService,
    private readonly alerts: CostAlertService,
    @Optional() private readonly ses?: SESService,
  ) {}

  onModuleInit(): void {
    this.usage.addListener(this);
    scheduledTaskRegistry.register(
      'daily',
      'billing-spend-reconcile',
      async () => {
        await this.reconcile();
      },
    );
  }

  // ── counting ────────────────────────────────────────────────────────

  async onUsageRecorded(
    manager: EntityManager,
    event: UsageEvent,
  ): Promise<void> {
    const userId = event.creatorUserId;
    const cost = Number(event.costMicros ?? 0);
    if (!userId || !(cost > 0)) return;
    const creatorPlan = await this.plans.planOf(userId, manager);
    const period = periodFor(creatorPlan.anchor, event.createdAt ?? new Date());
    const [row] = await manager.query(
      `INSERT INTO spend_periods ("userId", "periodStart", "periodEnd", "costMicros")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", "periodStart")
         DO UPDATE SET "costMicros" = spend_periods."costMicros" + EXCLUDED."costMicros", "updatedAt" = now()
       RETURNING "costMicros", "alerted80At", "alerted100At"`,
      [userId, period.start, period.end, cost],
    );
    const { capMicros } = capOf(creatorPlan.plan, creatorPlan.subscription);
    if (capMicros === null) return;
    const used = Number(row.costMicros);
    const crossed: 80 | 100 | null =
      used >= capMicros && !row.alerted100At
        ? 100
        : used >= capMicros * 0.8 && !row.alerted80At
          ? 80
          : null;
    if (!crossed) return;
    await manager.query(
      crossed === 100
        ? `UPDATE spend_periods SET "alerted100At" = now(), "alerted80At" = coalesce("alerted80At", now())
            WHERE "userId" = $1 AND "periodStart" = $2`
        : `UPDATE spend_periods SET "alerted80At" = now() WHERE "userId" = $1 AND "periodStart" = $2`,
      [userId, period.start],
    );
    // Told after this event's transaction has had its turn: never an email inside it.
    setImmediate(() => {
      void this.notify(userId, crossed, used, capMicros, period).catch(
        (error) =>
          this.logger.warn(
            `Spend cap notice failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          ),
      );
    });
  }

  /** This period's spend against the cap. */
  async state(userId: number, known?: CreatorPlan): Promise<SpendState> {
    const creatorPlan = known ?? (await this.plans.planOf(userId));
    const period = periodFor(creatorPlan.anchor);
    const [row] = await this.dataSource.query(
      `SELECT "costMicros" FROM spend_periods WHERE "userId" = $1 AND "periodStart" = $2`,
      [userId, period.start],
    );
    return {
      usedMicros: Number(row?.costMicros ?? 0),
      ...capOf(creatorPlan.plan, creatorPlan.subscription),
      period,
    };
  }

  /** True when a run must not start: the creator has a cap and this period's cost has reached it. */
  async isOverCap(
    userId: number | null | undefined,
    known?: CreatorPlan,
  ): Promise<boolean> {
    if (!userId) return false;
    const creatorPlan = known ?? (await this.plans.planOf(userId));
    if (capOf(creatorPlan.plan, creatorPlan.subscription).capMicros === null) {
      return false;
    }
    const state = await this.state(userId, creatorPlan);
    return state.capMicros !== null && state.usedMicros >= state.capMicros;
  }

  // ── admin ───────────────────────────────────────────────────────────

  /** Ally admin → a user → Spend: this period against the cap, where it went, and the history. */
  async summary(userId: number) {
    const creatorPlan = await this.plans.planOf(userId);
    const state = await this.state(userId, creatorPlan);
    const byAssistant: Array<Record<string, string>> =
      await this.dataSource.query(
        `SELECT e."chatbotId", coalesce(c.name, 'Setup drafts') AS name,
                sum(e."inputTokens" + e."outputTokens") AS tokens, coalesce(sum(e."costMicros"), 0) AS cost
           FROM usage_events e LEFT JOIN chatbots c ON c.id = e."chatbotId"
          WHERE e."creatorUserId" = $1 AND e."createdAt" >= $2 AND e."createdAt" < $3
          GROUP BY 1, 2 ORDER BY cost DESC`,
        [userId, state.period.start, state.period.end],
      );
    const byKind: Array<Record<string, string>> = await this.dataSource.query(
      `SELECT kind, sum("inputTokens" + "outputTokens") AS tokens, coalesce(sum("costMicros"), 0) AS cost
         FROM usage_events
        WHERE "creatorUserId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
        GROUP BY kind ORDER BY cost DESC`,
      [userId, state.period.start, state.period.end],
    );
    return {
      isCreator: await this.plans.isCreator(userId),
      planName: creatorPlan.plan.name,
      usedUsd: microsToUsd(state.usedMicros),
      capUsd: state.capMicros === null ? null : microsToUsd(state.capMicros),
      capSource: state.capSource,
      planCapUsd:
        creatorPlan.plan.costCapMicros === null
          ? null
          : microsToUsd(creatorPlan.plan.costCapMicros),
      resetsOn: state.period.end,
      usage: {
        byAssistant: byAssistant.map((row) => ({
          chatbotId: row.chatbotId,
          name: row.name,
          tokens: Number(row.tokens),
          costUsd: microsToUsd(row.cost),
        })),
        byKind: byKind.map((row) => ({
          kind: row.kind,
          tokens: Number(row.tokens),
          costUsd: microsToUsd(row.cost),
        })),
      },
      history: await this.audit.historyOf('spend_cap', String(userId)),
    };
  }

  /**
   * One creator's own cap: an amount, their plan's (`capUsd: null`), or never capped (`off`).
   * A creator with no subscription gets one on the plan they are already on, anchored where their
   * counters already reset, so nothing else about their plan moves.
   */
  async setCap(
    userId: number,
    input: { capUsd?: number | null; off?: boolean; note: string },
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(input.note);
    if (!(await this.plans.isCreator(userId))) {
      throw new BadRequestException(
        'Only chatbot creators have a cost cap: people who created an assistant, or custom logins with Chatbots on.',
      );
    }
    const capMicros = validCap(input.capUsd);
    const off = Boolean(input.off);
    await this.dataSource.transaction(async (manager) => {
      const creatorPlan = await this.plans.planOf(userId, manager);
      const repo = manager.getRepository(Subscription);
      const before = creatorPlan.subscription;
      const saved = await repo.save(
        repo.create({
          ...(before ?? {
            userId,
            planId: creatorPlan.plan.id,
            status: SubscriptionStatus.ACTIVE,
            periodStart: creatorPlan.anchor,
            periodEnd: null,
            setBy: actor,
            note,
          }),
          costCapMicros: capMicros,
          costCapOff: off,
        }),
      );
      // A changed cap is a new line to cross: Ally and the owner hear again if it is reached.
      await manager.query(
        `UPDATE spend_periods SET "alerted80At" = NULL, "alerted100At" = NULL
          WHERE "userId" = $1 AND "periodStart" = $2`,
        [userId, periodFor(creatorPlan.anchor).start],
      );
      await this.audit.record(
        {
          subjectType: 'spend_cap',
          subjectId: String(userId),
          action: off ? 'off' : capMicros === null ? 'plan' : 'set',
          before: before
            ? {
                costCapMicros: before.costCapMicros,
                costCapOff: before.costCapOff,
              }
            : null,
          after: {
            costCapMicros: saved.costCapMicros,
            costCapOff: saved.costCapOff,
          },
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    return this.summary(userId);
  }

  // ── jobs ────────────────────────────────────────────────────────────

  /**
   * Nightly: every open period's total is set to what its usage events add up to. Usage priced
   * after it was recorded (a model added to the list later) is picked up here.
   */
  async reconcile(now = new Date()): Promise<number> {
    const [, corrected] = await this.dataSource.query(
      `UPDATE spend_periods p SET "costMicros" = e.cost, "updatedAt" = now()
         FROM (SELECT s."userId", s."periodStart",
                      coalesce((SELECT sum(u."costMicros") FROM usage_events u
                                 WHERE u."creatorUserId" = s."userId"
                                   AND u."createdAt" >= s."periodStart" AND u."createdAt" < s."periodEnd"), 0) AS cost
                 FROM spend_periods s WHERE s."periodEnd" > $1) e
        WHERE p."userId" = e."userId" AND p."periodStart" = e."periodStart" AND p."costMicros" <> e.cost
        RETURNING p."userId"`,
      [now.toISOString().slice(0, 10)],
    );
    return Number(corrected ?? 0);
  }

  // ── notices ─────────────────────────────────────────────────────────

  /** Ally at 80% and 100% (dollars); the owner at 100% only, with no amount. */
  private async notify(
    userId: number,
    pct: 80 | 100,
    usedMicros: number,
    capMicros: number,
    period: { start: string; end: string },
  ): Promise<void> {
    await this.alerts.fire(
      CostAlertKind.SPEND_CAP,
      `${userId}:${pct}:${period.start}`,
      new Date(),
      pct === 100
        ? `User ${userId} has reached their monthly cost cap (${usd(usedMicros)} of ${usd(capMicros)}). Their assistants give the "not available" reply until the cap is raised or it resets on ${period.end}.`
        : `User ${userId} has used 80% of their monthly cost cap (${usd(usedMicros)} of ${usd(capMicros)}). Their assistants stop answering at 100%; it resets on ${period.end}.`,
      { userId, percent: pct, usedMicros, capMicros, resetsOn: period.end },
    );
    if (pct !== 100 || !this.ses) return;
    const [user] = await this.dataSource.query(
      `SELECT email FROM users WHERE id = $1`,
      [userId],
    );
    if (!user?.email) return;
    await this.ses.sendEmail({
      to: user.email,
      subject: "Your Ally plan: this month's usage limit is reached",
      body: `Your account has reached this month's usage limit, so your assistants give a short "not available" reply until it resets. Crisis replies always go out. Ask Ally to raise it, or see Plan and usage.`,
      purpose: 'billing-limit-alert',
      maskRecipientsInLog: true,
      alertOnFailure: false,
    });
  }
}

function validCap(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(
      'A cost cap must be more than $0 (or empty to use the plan’s).',
    );
  }
  return usdToMicros(n);
}
