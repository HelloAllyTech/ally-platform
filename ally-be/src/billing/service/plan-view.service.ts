import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CounterSubject, SeatKind } from '../enum/billing.enum';
import { BillingAuditService } from './billing-audit.service';
import { PlanService, dayString, periodFor } from './plan.service';
import { TokenService } from './token.service';

export interface Bar {
  used: number;
  /** Null: unlimited. */
  limit: number | null;
  resetsOn: string;
}

/**
 * What a plan's numbers look like (CR1 Part C): the owner's "Plan and usage", an assistant's
 * Share → People, and Ally admin → a user → Plan. Counts and limits only — **never dollars**; the
 * admin's prices live on Ally admin → Plans and Costs.
 */
@Injectable()
export class PlanViewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly plans: PlanService,
    private readonly tokens: TokenService,
    private readonly audit: BillingAuditService,
  ) {}

  /** The creator's plan and usage (account menu). */
  async forUser(userId: number) {
    const isCreator = await this.plans.isCreator(userId);
    const tokenState = await this.tokens.state(userId);
    const tokens = tokenState.hasAllowance
      ? {
          unlimited: tokenState.unlimited,
          left: Math.max(0, tokenState.left),
          granted: tokenState.granted,
          resetsOn: tokenState.resetsOn ? dayString(tokenState.resetsOn) : null,
        }
      : null;
    if (!isCreator) return { isCreator: false, tokens };

    const { plan, subscription, anchor } = await this.plans.planOf(userId);
    const period = periodFor(anchor);
    const published = await this.plans.publishedCount(userId);
    const assistants: Array<{ id: string; name: string; status: string }> =
      await this.dataSource.query(
        `SELECT id, name, status FROM chatbots WHERE created_by = $1 AND archived_at IS NULL ORDER BY "createdAt"`,
        [userId],
      );
    const ownerRuns = await this.bar(
      CounterSubject.OWNER_RUNS,
      String(userId),
      period,
      plan.ownerRuns,
    );
    const perAssistant = [];
    for (const bot of assistants) {
      perAssistant.push({
        chatbotId: bot.id,
        name: bot.name,
        status: bot.status,
        ...(await this.assistantUsage(
          bot.id,
          plan.customerConversations,
          period,
        )),
      });
    }
    return {
      isCreator: true,
      plan: {
        key: plan.key,
        name: plan.name,
        maxPublished: plan.maxPublished,
        published,
        line:
          plan.maxPublished === null
            ? `${plan.name} · ${published} published`
            : `${plan.name} · ${published} of ${plan.maxPublished} assistants published`,
        status: subscription?.status ?? 'active',
      },
      period,
      tokens,
      ownerRuns,
      assistants: perAssistant,
      alerts: this.alertsFrom(ownerRuns, perAssistant),
    };
  }

  /** One assistant's seats and this period's counts (Share → People; any member may see them). */
  async forAssistant(chatbotId: string) {
    const [bot] = await this.dataSource.query(
      `SELECT id, name, status, created_by AS "createdBy" FROM chatbots WHERE id = $1`,
      [chatbotId],
    );
    if (!bot) return null;
    const { plan, anchor } = await this.plans.planOf(bot.createdBy);
    const usage = await this.assistantUsage(
      chatbotId,
      plan.customerConversations,
      periodFor(anchor),
    );
    const people = await this.plans.peopleInOrder(chatbotId);
    const seated = new Set(
      usage.seats
        .filter((seat) => seat.assigneeEmail)
        .map((seat) => seat.assigneeEmail),
    );
    return {
      chatbotId,
      name: bot.name,
      published: bot.status === 'live',
      seatsRequired: plan.seatsRequired,
      ...usage,
      people: people.map((person) => ({
        email: person.email,
        role: person.why,
        hasSeat: seated.has(person.email),
      })),
    };
  }

  /** Ally admin → a user → Plan: the owner's view plus the subscription and history. */
  async forAdmin(userId: number) {
    const view = await this.forUser(userId);
    const subscription = await this.dataSource.query(
      `SELECT s.*, p.key AS "planKey", p.name AS "planName" FROM subscriptions s JOIN plans p ON p.id = s."planId" WHERE s."userId" = $1`,
      [userId],
    );
    const assistantIds =
      'assistants' in view && view.assistants
        ? view.assistants.map((a) => a.chatbotId)
        : [];
    // Only this creator's changes: their subscription, and seats on their assistants.
    const seatIds = new Set(
      'assistants' in view && view.assistants
        ? view.assistants.flatMap((a) => a.seats.map((seat) => seat.id))
        : [],
    );
    const sub = subscription[0] ?? null;
    return {
      ...view,
      subscription: sub
        ? {
            planKey: sub.planKey as string,
            planName: sub.planName as string,
            status: sub.status as string,
            periodStart: dayString(sub.periodStart),
            periodEnd: sub.periodEnd ? dayString(sub.periodEnd) : null,
            note: (sub.note as string | null) ?? null,
          }
        : null,
      history: await this.audit
        .historyOf(['subscription', 'seats', 'seat'], undefined, 500)
        .then((rows) =>
          rows.filter(
            (row) =>
              (row.subjectType === 'subscription' &&
                row.subjectId === String(userId)) ||
              (row.subjectType === 'seats' &&
                assistantIds.includes(row.subjectId)) ||
              (row.subjectType === 'seat' && seatIds.has(row.subjectId)),
          ),
        ),
    };
  }

  private async assistantUsage(
    chatbotId: string,
    customerLimit: number | null,
    period: { start: string; end: string },
  ) {
    const seats = await this.plans.seatsOf(chatbotId);
    const seatRows = [];
    for (const seat of seats) {
      const seatPeriod = periodFor(dayString(seat.startDate));
      const bar = await this.bar(
        CounterSubject.SEAT,
        seat.id,
        seatPeriod,
        seat.messagesPerMonth,
      );
      seatRows.push({
        id: seat.id,
        kind: seat.kind,
        typeKey: seat.typeKey,
        typeName: seat.typeName,
        assigneeEmail: seat.assigneeEmail,
        startDate: dayString(seat.startDate),
        nextRenewal: seat.nextRenewal ? dayString(seat.nextRenewal) : null,
        status: seat.status,
        messages: bar,
      });
    }
    const included = seatRows.filter(
      (s) => s.kind === SeatKind.INCLUDED,
    ).length;
    const extras = seatRows.filter((s) => s.kind === SeatKind.EXTRA);
    const extraByType = new Map<string, number>();
    for (const seat of extras)
      extraByType.set(seat.typeName, (extraByType.get(seat.typeName) ?? 0) + 1);
    const summary = [
      `${included} included`,
      ...[...extraByType.entries()].map(([name, n]) => `${n} extra ${name}`),
    ].join(' · ');
    return {
      seats: seatRows,
      seatSummary: summary,
      unassigned: seatRows.filter(
        (s) => !s.assigneeEmail && s.status !== 'lapsed',
      ).length,
      customers: await this.bar(
        CounterSubject.CUSTOMERS,
        chatbotId,
        period,
        customerLimit,
      ),
    };
  }

  private async bar(
    subject: CounterSubject,
    subjectId: string,
    period: { start: string; end: string },
    limit: number | null,
  ): Promise<Bar> {
    const [row] = await this.dataSource.query(
      `SELECT count FROM usage_counters WHERE "subjectType" = $1 AND "subjectId" = $2 AND "periodStart" = $3`,
      [subject, subjectId, period.start],
    );
    return { used: Number(row?.count ?? 0), limit, resetsOn: period.end };
  }

  /** The home banner: limits at 80% or more this period. */
  private alertsFrom(
    ownerRuns: Bar,
    assistants: Array<{
      name: string;
      customers: Bar;
      seats: Array<{ assigneeEmail: string | null; messages: Bar }>;
    }>,
  ) {
    const out: Array<{ what: string; percent: number }> = [];
    const pct = (bar: Bar) =>
      bar.limit ? Math.floor((bar.used / bar.limit) * 100) : 0;
    if (pct(ownerRuns) >= 80)
      out.push({ what: 'Setup and checkup runs', percent: pct(ownerRuns) });
    for (const bot of assistants) {
      if (pct(bot.customers) >= 80)
        out.push({
          what: `Customer conversations on ${bot.name}`,
          percent: pct(bot.customers),
        });
      for (const seat of bot.seats) {
        if (seat.assigneeEmail && pct(seat.messages) >= 80) {
          out.push({
            what: `Messages for ${seat.assigneeEmail} on ${bot.name}`,
            percent: pct(seat.messages),
          });
        }
      }
    }
    return out;
  }
}
