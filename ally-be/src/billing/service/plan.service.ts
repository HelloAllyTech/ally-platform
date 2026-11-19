import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { Plan } from '../entity/plan.entity';
import { Seat } from '../entity/seat.entity';
import { SeatType } from '../entity/seat-type.entity';
import { Subscription } from '../entity/subscription.entity';
import {
  CostAlertKind,
  SeatKind,
  SeatStatus,
  SubscriptionStatus,
} from '../enum/billing.enum';
import { microsToUsd, usdToMicros } from '../util/pricing.util';
import { BillingAuditService } from './billing-audit.service';
import { CostAlertService } from './cost-alert.service';

export const DEFAULT_PLAN_KEY = 'free';
const DAY_MS = 86_400_000;

// ── dates (UTC calendar days, `YYYY-MM-DD`) ──────────────────────────

export const dayString = (value: unknown): string =>
  value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value ?? '').slice(0, 10);

const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

/** The same day `months` later, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(
  day: string,
  months: number,
  anchorDay?: number,
): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay ?? d, last));
  return utcDay(target);
}

/** The monthly period, anchored on `anchor`'s day of the month, that contains `now`. */
export function periodFor(
  anchor: string,
  now = new Date(),
): { start: string; end: string } {
  const anchorDay = Number(dayString(anchor).slice(8, 10)) || 1;
  const today = utcDay(now);
  let start = dayString(anchor);
  if (start > today) return { start, end: addMonths(start, 1, anchorDay) };
  // Walk forward from the anchor in whole months (bounded: plans are years, not centuries).
  for (let i = 0; i < 1200; i += 1) {
    const next = addMonths(start, 1, anchorDay);
    if (next > today) return { start, end: next };
    start = next;
  }
  return { start, end: addMonths(start, 1, anchorDay) };
}

export interface CreatorPlan {
  plan: Plan;
  subscription: Subscription | null;
  /** The day the plan's counters reset from. */
  anchor: string;
}

/**
 * Plans and seats (CR1 Part C). Plans belong only to chatbot creators: the user who created an
 * assistant pays for it through their plan, whoever else manages it. Ally assigns plans and seats;
 * online payment is later (Phase 3, block 16).
 */
@Injectable()
export class PlanService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: BillingAuditService,
    private readonly alerts: CostAlertService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      'daily',
      'billing-seat-renewals',
      async () => {
        await this.renewSeats();
      },
    );
  }

  // ── plans and seat types (Ally admin → Plans) ───────────────────────

  async catalogue() {
    const [plans, seatTypes] = await Promise.all([
      this.dataSource.getRepository(Plan).find({ order: { createdAt: 'ASC' } }),
      this.dataSource.getRepository(SeatType).find({ order: { rank: 'ASC' } }),
    ]);
    return {
      plans: plans.map((plan) => ({
        ...plan,
        // The key too, as the plan form sends it back.
        includedSeatTypeKey:
          seatTypes.find((type) => type.id === plan.includedSeatTypeId)?.key ??
          null,
        price: plan.priceMicros === null ? null : microsToUsd(plan.priceMicros),
      })),
      seatTypes: seatTypes.map((type) => ({
        ...type,
        price: type.priceMicros === null ? null : microsToUsd(type.priceMicros),
      })),
      renewalsDue: await this.renewalsDue(7),
    };
  }

  async savePlan(
    input: {
      id?: string;
      key?: string;
      name: string;
      maxPublished: number | null;
      includedSeats: number;
      includedSeatTypeKey?: string | null;
      customerConversations: number | null;
      ownerRuns: number | null;
      seatsRequired?: boolean;
      priceUsd?: number | null;
      active?: boolean;
      note: string;
    },
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(input.note);
    const repo = this.dataSource.getRepository(Plan);
    const before = input.id
      ? await repo.findOne({ where: { id: input.id } })
      : null;
    if (input.id && !before) throw new NotFoundException('No such plan.');
    const key = before?.key ?? slugKey(input.key ?? input.name);
    if (!before && (await repo.findOne({ where: { key } }))) {
      throw new ConflictException(`A plan called "${key}" already exists.`);
    }
    const seatType = input.includedSeatTypeKey
      ? await this.seatTypeByKey(input.includedSeatTypeKey)
      : null;
    const row = repo.create({
      ...(before ?? {}),
      key,
      name: requiredText(input.name, 'Name the plan.'),
      maxPublished: limit(input.maxPublished, 'Published assistants'),
      includedSeats: limit(input.includedSeats, 'Included seats') ?? 0,
      includedSeatTypeId: seatType?.id ?? before?.includedSeatTypeId ?? null,
      customerConversations: limit(
        input.customerConversations,
        'Customer conversations',
      ),
      ownerRuns: limit(input.ownerRuns, 'Owner-side runs'),
      seatsRequired: input.seatsRequired ?? before?.seatsRequired ?? true,
      priceMicros: money(input.priceUsd),
      active: input.active ?? before?.active ?? true,
    });
    const saved = await repo.save(row);
    await this.audit.record({
      subjectType: 'plan',
      subjectId: saved.id,
      action: before ? 'edit' : 'add',
      before,
      after: saved,
      note,
      actorUserId: actor,
    });
    return this.catalogue();
  }

  async saveSeatType(
    input: {
      id?: string;
      key?: string;
      name: string;
      messagesPerMonth: number | null;
      rank?: number;
      priceUsd?: number | null;
      active?: boolean;
      note: string;
    },
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(input.note);
    const repo = this.dataSource.getRepository(SeatType);
    const before = input.id
      ? await repo.findOne({ where: { id: input.id } })
      : null;
    if (input.id && !before) throw new NotFoundException('No such seat type.');
    const key = before?.key ?? slugKey(input.key ?? input.name);
    if (!before && (await repo.findOne({ where: { key } }))) {
      throw new ConflictException(
        `A seat type called "${key}" already exists.`,
      );
    }
    const saved = await repo.save(
      repo.create({
        ...(before ?? {}),
        key,
        name: requiredText(input.name, 'Name the seat type.'),
        messagesPerMonth: limit(input.messagesPerMonth, 'Messages per month'),
        rank: Number.isInteger(input.rank)
          ? Number(input.rank)
          : (before?.rank ?? 1),
        priceMicros: money(input.priceUsd),
        active: input.active ?? before?.active ?? true,
      }),
    );
    await this.audit.record({
      subjectType: 'seat_type',
      subjectId: saved.id,
      action: before ? 'edit' : 'add',
      before,
      after: saved,
      note,
      actorUserId: actor,
    });
    return this.catalogue();
  }

  // ── a creator's plan ────────────────────────────────────────────────

  /** A creator's plan; no subscription is the default plan from the creator's first assistant. */
  async planOf(userId: number, manager?: EntityManager): Promise<CreatorPlan> {
    const db = manager ?? this.dataSource.manager;
    const subscription = await db
      .getRepository(Subscription)
      .findOne({ where: { userId } });
    const plan = subscription
      ? await db
          .getRepository(Plan)
          .findOne({ where: { id: subscription.planId } })
      : await db
          .getRepository(Plan)
          .findOne({ where: { key: DEFAULT_PLAN_KEY } });
    if (!plan) throw new NotFoundException('The plan is missing. Ask Ally.');
    let anchor = subscription ? dayString(subscription.periodStart) : '';
    if (!anchor) {
      const [first] = await db.query(
        `SELECT min("createdAt") AS at FROM chatbots WHERE created_by = $1`,
        [userId],
      );
      anchor = first?.at ? utcDay(new Date(first.at)) : utcDay(new Date());
    }
    return { plan, subscription, anchor };
  }

  /** Users who have created an assistant, or custom logins with Chatbots on. */
  async isCreator(userId: number): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM chatbots WHERE created_by = $1)
           OR EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                       JOIN admin_feature_toggles t ON t."userId" = ug."userId"
                      WHERE ug."userId" = $1 AND g.name = 'ASSISTANT_OWNER'
                        AND t."featureKey" = 'whatsapp_bot' AND t.enabled) AS creator`,
      [userId],
    );
    return Boolean(row?.creator);
  }

  async setPlan(
    userId: number,
    input: {
      planKey: string;
      periodStart?: string;
      periodEnd?: string | null;
      status?: SubscriptionStatus;
      note: string;
    },
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(input.note);
    if (!(await this.isCreator(userId))) {
      throw new BadRequestException(
        'Only chatbot creators have a plan: people who created an assistant, or custom logins with Chatbots on.',
      );
    }
    const plan = await this.dataSource
      .getRepository(Plan)
      .findOne({ where: { key: input.planKey } });
    if (!plan) throw new NotFoundException('No such plan.');
    if (
      input.status &&
      !Object.values(SubscriptionStatus).includes(input.status)
    ) {
      throw new BadRequestException('Unknown status.');
    }
    const repo = this.dataSource.getRepository(Subscription);
    const before = await repo.findOne({ where: { userId } });
    const saved = await repo.save(
      repo.create({
        ...(before ?? {}),
        userId,
        planId: plan.id,
        status: input.status ?? before?.status ?? SubscriptionStatus.ACTIVE,
        periodStart: input.periodStart
          ? validDay(input.periodStart)
          : (before?.periodStart ?? utcDay(new Date())),
        periodEnd:
          input.periodEnd === undefined
            ? (before?.periodEnd ?? null)
            : input.periodEnd
              ? validDay(input.periodEnd)
              : null,
        setBy: actor,
        note,
      }),
    );
    await this.audit.record({
      subjectType: 'subscription',
      subjectId: String(userId),
      action: before ? 'edit' : 'add',
      before,
      after: { ...saved, planKey: plan.key },
      note,
      actorUserId: actor,
    });
    return saved;
  }

  // ── publishing ──────────────────────────────────────────────────────

  async publishedCount(
    userId: number,
    manager?: EntityManager,
    except?: string,
  ): Promise<number> {
    const [row] = await (manager ?? this.dataSource.manager).query(
      `SELECT count(*) AS n FROM chatbots
        WHERE created_by = $1 AND status = 'live' AND archived_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [userId, except ?? null],
    );
    return Number(row.n);
  }

  /**
   * Refuse publishing past the plan's limit. An assistant already live passes (re-publishing, a
   * change). Lowering a plan never unpublishes; new publishing waits until under the limit.
   */
  async assertCanPublish(
    chatbotId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const db = manager ?? this.dataSource.manager;
    const [bot] = await db.query(
      `SELECT created_by AS "createdBy", status FROM chatbots WHERE id = $1`,
      [chatbotId],
    );
    if (!bot || bot.status === 'live') return;
    const { plan } = await this.planOf(bot.createdBy, manager);
    if (plan.maxPublished === null) return;
    const published = await this.publishedCount(
      bot.createdBy,
      manager,
      chatbotId,
    );
    if (published >= plan.maxPublished) {
      throw new ForbiddenException({
        message: publishLimitMessage(plan),
        errorCode: 'PLAN_PUBLISH_LIMIT',
      });
    }
  }

  /** "This uses 1 of your 3 assistants", for the publish screen. */
  async publishUse(chatbotId: string) {
    const [bot] = await this.dataSource.query(
      `SELECT created_by AS "createdBy", status FROM chatbots WHERE id = $1`,
      [chatbotId],
    );
    if (!bot) throw new NotFoundException('Assistant not found.');
    const { plan } = await this.planOf(bot.createdBy);
    const others = await this.publishedCount(
      bot.createdBy,
      undefined,
      chatbotId,
    );
    const max = plan.maxPublished;
    return {
      planName: plan.name,
      maxPublished: max,
      published: others + (bot.status === 'live' ? 1 : 0),
      wouldUse: others + 1,
      canPublish: bot.status === 'live' || max === null || others < max,
      message:
        max === null
          ? null
          : others < max || bot.status === 'live'
            ? null
            : publishLimitMessage(plan),
    };
  }

  // ── seats ───────────────────────────────────────────────────────────

  /**
   * A newly published assistant's included seats: owners first, then editors, then invited emails,
   * until they run out. Idempotent: an assistant that already has its included seats gets none.
   */
  async ensureIncludedSeats(
    chatbotId: string,
    manager?: EntityManager,
    actor: number | null = null,
  ) {
    const db = manager ?? this.dataSource.manager;
    const [bot] = await db.query(
      `SELECT created_by AS "createdBy" FROM chatbots WHERE id = $1`,
      [chatbotId],
    );
    if (!bot) return [];
    const { plan } = await this.planOf(bot.createdBy, manager);
    const [{ n }] = await db.query(
      `SELECT count(*) AS n FROM seats WHERE "chatbotId" = $1 AND kind = 'included' AND status <> 'cancelled'`,
      [chatbotId],
    );
    const missing = plan.includedSeats - Number(n);
    if (missing <= 0) return [];
    const typeId =
      plan.includedSeatTypeId ??
      (
        await db
          .getRepository(SeatType)
          .findOne({ where: { active: true }, order: { rank: 'ASC' } })
      )?.id;
    if (!typeId) return [];
    const people = await this.peopleInOrder(chatbotId, db);
    const taken = new Set(
      (
        await db.query(
          `SELECT "assigneeEmail" FROM seats WHERE "chatbotId" = $1 AND "assigneeEmail" IS NOT NULL AND status IN ('active','expiring')`,
          [chatbotId],
        )
      ).map((row: { assigneeEmail: string }) => row.assigneeEmail),
    );
    const free = people.filter((person) => !taken.has(person.email));
    const today = utcDay(new Date());
    const created: Seat[] = [];
    for (let i = 0; i < missing; i += 1) {
      const person = free[i];
      created.push(
        await db.getRepository(Seat).save(
          db.getRepository(Seat).create({
            chatbotId,
            seatTypeId: typeId,
            kind: SeatKind.INCLUDED,
            assigneeEmail: person?.email ?? null,
            assigneeUserId: person?.userId ?? null,
            startDate: today,
            nextRenewal: null,
            status: SeatStatus.ACTIVE,
            addedBy: actor,
            note: 'Included with the plan',
          }),
        ),
      );
    }
    return created;
  }

  /** Owners, then editors, then viewers, then invited emails: who gets a seat first. */
  async peopleInOrder(
    chatbotId: string,
    db: EntityManager = this.dataSource.manager,
  ): Promise<Array<{ email: string; userId: number | null; why: string }>> {
    const members: Array<{ email: string; userId: number; role: string }> =
      await db.query(
        `SELECT lower(u.email) AS email, u.id AS "userId", m.role FROM chatbot_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.chatbot_id = $1 AND u.email IS NOT NULL
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m."createdAt"`,
        [chatbotId],
      );
    const invited: Array<{ email: string }> = await db
      .query(
        `SELECT lower(a.value) AS email FROM chatbot_page_access a
           JOIN chatbot_pages p ON p.id = a.page_id
          WHERE p.chatbot_id = $1 AND a.kind = 'email' ORDER BY a."createdAt"`,
        [chatbotId],
      )
      .catch(() => []);
    const seen = new Set<string>();
    const out: Array<{ email: string; userId: number | null; why: string }> =
      [];
    for (const member of members) {
      if (seen.has(member.email)) continue;
      seen.add(member.email);
      out.push({
        email: member.email,
        userId: member.userId,
        why: member.role,
      });
    }
    for (const person of invited) {
      if (!person.email || seen.has(person.email)) continue;
      seen.add(person.email);
      out.push({ email: person.email, userId: null, why: 'invited' });
    }
    return out;
  }

  async seatsOf(chatbotId: string) {
    const rows: Array<
      Seat & {
        typeKey: string;
        typeName: string;
        messagesPerMonth: number | null;
      }
    > = await this.dataSource.query(
      `SELECT s.*, t.key AS "typeKey", t.name AS "typeName", t."messagesPerMonth"
           FROM seats s JOIN seat_types t ON t.id = s."seatTypeId"
          WHERE s."chatbotId" = $1 AND s.status <> 'cancelled'
          ORDER BY s.kind DESC, s."createdAt"`,
      [chatbotId],
    );
    return rows;
  }

  /** The live seat a person holds on an assistant, if any. */
  async seatFor(chatbotId: string, email: string | null | undefined) {
    if (!email) return null;
    const [seat] = await this.dataSource.query(
      `SELECT s.*, t."messagesPerMonth", t.name AS "typeName" FROM seats s JOIN seat_types t ON t.id = s."seatTypeId"
        WHERE s."chatbotId" = $1 AND s."assigneeEmail" = $2 AND s.status IN ('active','expiring','lapsed')
        ORDER BY CASE s.status WHEN 'lapsed' THEN 1 ELSE 0 END LIMIT 1`,
      [chatbotId, email.trim().toLowerCase()],
    );
    return (seat ?? null) as
      | (Seat & { messagesPerMonth: number | null; typeName: string })
      | null;
  }

  async addSeats(
    chatbotId: string,
    input: {
      seatTypeKey: string;
      count: number;
      startDate?: string;
      note: string;
    },
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(input.note);
    const count = Number(input.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new BadRequestException('Add between 1 and 500 seats.');
    }
    const type = await this.seatTypeByKey(input.seatTypeKey);
    const startDate = input.startDate
      ? validDay(input.startDate)
      : utcDay(new Date());
    await this.assertChatbot(chatbotId);
    const created = await this.dataSource.transaction(async (manager) => {
      const rows: Seat[] = [];
      for (let i = 0; i < count; i += 1) {
        rows.push(
          await manager.getRepository(Seat).save(
            manager.getRepository(Seat).create({
              chatbotId,
              seatTypeId: type.id,
              kind: SeatKind.EXTRA,
              startDate,
              nextRenewal: addMonths(startDate, 1),
              status: SeatStatus.ACTIVE,
              addedBy: actor,
              note,
            }),
          ),
        );
      }
      await this.audit.record(
        {
          subjectType: 'seats',
          subjectId: chatbotId,
          action: 'add',
          after: {
            count,
            seatType: type.key,
            startDate,
            ids: rows.map((r) => r.id),
          },
          note,
          actorUserId: actor,
        },
        manager,
      );
      return rows;
    });
    return created;
  }

  /** Renew an extra seat now (or bring back a lapsed one): its next renewal moves a month on. */
  async renewSeat(seatId: string, noteInput: string, actor: number | null) {
    const note = BillingAuditService.requireNote(noteInput);
    const seat = await this.seatOr404(seatId);
    if (seat.status === SeatStatus.CANCELLED)
      throw new ConflictException(
        'A cancelled seat can’t be renewed. Add a new one.',
      );
    const before = { ...seat };
    const today = utcDay(new Date());
    if (seat.kind === SeatKind.EXTRA) {
      let next = dayString(seat.nextRenewal ?? today);
      const anchor = Number(dayString(seat.startDate).slice(8, 10));
      do next = addMonths(next, 1, anchor);
      while (next <= today);
      seat.nextRenewal = next;
    }
    seat.status = SeatStatus.ACTIVE;
    await this.dataSource.getRepository(Seat).save(seat);
    await this.audit.record({
      subjectType: 'seat',
      subjectId: seatId,
      action: 'renew',
      before,
      after: seat,
      note,
      actorUserId: actor,
    });
    return seat;
  }

  async cancelSeat(seatId: string, noteInput: string, actor: number | null) {
    const note = BillingAuditService.requireNote(noteInput);
    const seat = await this.seatOr404(seatId);
    const before = { ...seat };
    seat.status = SeatStatus.CANCELLED;
    seat.nextRenewal = null;
    await this.dataSource.getRepository(Seat).save(seat);
    await this.audit.record({
      subjectType: 'seat',
      subjectId: seatId,
      action: 'cancel',
      before,
      after: seat,
      note,
      actorUserId: actor,
    });
    return seat;
  }

  async changeSeatType(
    seatId: string,
    seatTypeKey: string,
    noteInput: string,
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(noteInput);
    const seat = await this.seatOr404(seatId);
    const type = await this.seatTypeByKey(seatTypeKey);
    const before = { ...seat };
    seat.seatTypeId = type.id;
    await this.dataSource.getRepository(Seat).save(seat);
    await this.audit.record({
      subjectType: 'seat',
      subjectId: seatId,
      action: 'type',
      before,
      after: seat,
      note,
      actorUserId: actor,
    });
    return seat;
  }

  /**
   * Assign or move a seat to a person (an email), or free it (null). Owners do this on their own
   * assistants; the caller checks that. The person must be on the assistant: a team member or an
   * invited email. A lapsed seat comes back when assigned again.
   */
  async assignSeat(
    chatbotId: string,
    seatId: string,
    email: string | null,
    actor: number | null,
  ) {
    const seat = await this.seatOr404(seatId);
    if (seat.chatbotId !== chatbotId)
      throw new NotFoundException('Seat not found.');
    if (seat.status === SeatStatus.CANCELLED)
      throw new ConflictException('This seat is cancelled.');
    const before = { ...seat };
    const normalised = email ? email.trim().toLowerCase() : null;
    if (normalised) {
      const people = await this.peopleInOrder(chatbotId);
      const person = people.find((p) => p.email === normalised);
      if (!person) {
        throw new BadRequestException(
          'Invite this person to the assistant first, then give them a seat.',
        );
      }
      const holder = await this.seatFor(chatbotId, normalised);
      if (
        holder &&
        holder.id !== seatId &&
        holder.status !== SeatStatus.LAPSED
      ) {
        throw new ConflictException(
          'This person already has a seat on this assistant.',
        );
      }
      seat.assigneeEmail = normalised;
      seat.assigneeUserId = person.userId;
    } else {
      seat.assigneeEmail = null;
      seat.assigneeUserId = null;
    }
    if (
      seat.status === SeatStatus.LAPSED &&
      normalised &&
      seat.kind === SeatKind.INCLUDED
    ) {
      seat.status = SeatStatus.ACTIVE;
    }
    await this.dataSource.getRepository(Seat).save(seat);
    await this.audit.record({
      subjectType: 'seat',
      subjectId: seatId,
      action: normalised ? 'assign' : 'unassign',
      before,
      after: seat,
      note: normalised ? `Assigned to ${normalised}` : 'Freed',
      actorUserId: actor,
    });
    return seat;
  }

  /** Extra seats renewing within `days`, soonest first: the top of Ally admin → Plans. */
  async renewalsDue(days: number, now = new Date()) {
    const until = utcDay(new Date(now.getTime() + days * DAY_MS));
    return this.dataSource.query(
      `SELECT s.id, s."chatbotId", c.name AS assistant, s."nextRenewal", s.status, s."assigneeEmail",
              t.name AS "seatType", u.email AS "creatorEmail", c.created_by AS "creatorUserId"
         FROM seats s JOIN chatbots c ON c.id = s."chatbotId" JOIN seat_types t ON t.id = s."seatTypeId"
         LEFT JOIN users u ON u.id = c.created_by
        WHERE s.kind = 'extra' AND s.status IN ('active','expiring') AND s."nextRenewal" <= $1
        ORDER BY s."nextRenewal" ASC LIMIT 200`,
      [until],
    );
  }

  /**
   * Daily: each extra seat renews on its own date while its creator's subscription is active, and
   * lapses otherwise; seats within 7 days of renewal show as expiring, and Ally is told once.
   * Included seats never lapse while the subscription is active.
   */
  async renewSeats(
    now = new Date(),
  ): Promise<{ renewed: number; lapsed: number; expiring: number }> {
    const today = utcDay(now);
    const soon = utcDay(new Date(now.getTime() + 7 * DAY_MS));
    const due: Array<Seat & { subStatus: string | null }> =
      await this.dataSource.query(
        `SELECT s.*, sub.status AS "subStatus" FROM seats s JOIN chatbots c ON c.id = s."chatbotId"
         LEFT JOIN subscriptions sub ON sub."userId" = c.created_by
        WHERE s.kind = 'extra' AND s.status IN ('active','expiring') AND s."nextRenewal" <= $1`,
        [today],
      );
    let renewed = 0;
    let lapsed = 0;
    for (const seat of due) {
      if (!seat.subStatus || seat.subStatus === SubscriptionStatus.ACTIVE) {
        const anchor = Number(dayString(seat.startDate).slice(8, 10));
        let next = dayString(seat.nextRenewal);
        while (next <= today) next = addMonths(next, 1, anchor);
        await this.dataSource.query(
          `UPDATE seats SET "nextRenewal" = $2, status = 'active', "updatedAt" = now() WHERE id = $1`,
          [seat.id, next],
        );
        renewed += 1;
      } else {
        await this.dataSource.query(
          `UPDATE seats SET status = 'lapsed', "updatedAt" = now() WHERE id = $1`,
          [seat.id],
        );
        lapsed += 1;
      }
    }
    const [, expiringCount] = await this.dataSource.query(
      `UPDATE seats SET status = 'expiring', "updatedAt" = now()
        WHERE kind = 'extra' AND status = 'active' AND "nextRenewal" > $1 AND "nextRenewal" <= $2
        RETURNING id`,
      [today, soon],
    );
    const sevenDays: Array<{
      id: string;
      assistant: string;
      nextRenewal: string;
    }> = await this.dataSource.query(
      `SELECT s.id, c.name AS assistant, s."nextRenewal" FROM seats s JOIN chatbots c ON c.id = s."chatbotId"
        WHERE s.kind = 'extra' AND s.status IN ('active','expiring') AND s."nextRenewal" = $1`,
      [soon],
    );
    for (const seat of sevenDays) {
      await this.alerts.fire(
        CostAlertKind.SEAT_RENEWAL,
        `${seat.id}:${dayString(seat.nextRenewal)}`,
        now,
        `An extra seat on "${seat.assistant}" renews on ${dayString(seat.nextRenewal)}.`,
        { seatId: seat.id },
      );
    }
    return { renewed, lapsed, expiring: Number(expiringCount ?? 0) };
  }

  // ── helpers ─────────────────────────────────────────────────────────

  async seatTypeByKey(key: string): Promise<SeatType> {
    const type = await this.dataSource
      .getRepository(SeatType)
      .findOne({ where: { key } });
    if (!type || !type.active)
      throw new NotFoundException('No such seat type.');
    return type;
  }

  private async seatOr404(seatId: string): Promise<Seat> {
    const seat = await this.dataSource
      .getRepository(Seat)
      .findOne({ where: { id: seatId } });
    if (!seat) throw new NotFoundException('Seat not found.');
    return seat;
  }

  private async assertChatbot(chatbotId: string): Promise<void> {
    const [bot] = await this.dataSource.query(
      `SELECT id FROM chatbots WHERE id = $1`,
      [chatbotId],
    );
    if (!bot) throw new NotFoundException('Assistant not found.');
  }

  /** Seats per assistant, for the admin and owner screens. */
  async seatsByAssistant(chatbotIds: string[]) {
    if (!chatbotIds.length)
      return new Map<string, Awaited<ReturnType<PlanService['seatsOf']>>>();
    const rows = await this.dataSource
      .getRepository(Seat)
      .find({ where: { chatbotId: In(chatbotIds) } });
    const map = new Map<string, Awaited<ReturnType<PlanService['seatsOf']>>>();
    for (const id of new Set(rows.map((row) => row.chatbotId)))
      map.set(id, await this.seatsOf(id));
    return map;
  }
}

export function publishLimitMessage(
  plan: Pick<Plan, 'name' | 'maxPublished' | 'key'>,
): string {
  const n = plan.maxPublished ?? 0;
  const noun = n === 1 ? 'assistant' : 'assistants';
  return plan.key === DEFAULT_PLAN_KEY
    ? `${plan.name} publishes up to ${n} ${noun}. Ask Ally about Pro.`
    : `${plan.name} publishes up to ${n} ${noun}. Ask Ally to upgrade.`;
}

function limit(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new BadRequestException(
      `${label} must be a whole number, 0 or more (or empty for unlimited).`,
    );
  return n;
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new BadRequestException('A price must be zero or more.');
  return usdToMicros(n);
}

function requiredText(value: unknown, message: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new BadRequestException(message);
  return text.slice(0, 100);
}

function slugKey(value: string): string {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (!key) throw new BadRequestException('Give it a name.');
  return key.slice(0, 40);
}

function validDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException('Use a date like 2026-12-01.');
  }
  return value;
}
