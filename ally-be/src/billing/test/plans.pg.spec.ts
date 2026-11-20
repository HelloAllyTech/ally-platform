import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
} from '../../whatsapp/shared-store/test/shared-store.pg';
import { UsageChannel, UsageKind } from '../enum/billing.enum';
import { BillingAuditService } from '../service/billing-audit.service';
import { LimitsService } from '../service/limits.service';
import {
  PlanService,
  addMonths,
  dayString,
  periodFor,
} from '../service/plan.service';
import { PlanViewService } from '../service/plan-view.service';
import { SpendCapService } from '../service/spend-cap.service';
import { UsageEventService } from '../service/usage-event.service';
import { BILLING_ENTITIES } from './billing-entities';

/**
 * CR1 Part C on real Postgres: the publish limit, seats (strict, lapsing, assigning), counters that
 * count once and reset on the right day, owner-side runs, and a seat type added as data.
 */
describePg('Billing: plans, seats and limits (Postgres)', () => {
  let dataSource: DataSource;
  let plans: PlanService;
  let spend: SpendCapService;
  let limits: LimitsService;
  let views: PlanViewService;
  let creator: number;
  const alerts = { fire: async () => true } as never;

  beforeAll(async () => {
    dataSource = await openTestDataSource(BILLING_ENTITIES);
    const audit = new BillingAuditService(dataSource);
    plans = new PlanService(dataSource, audit, alerts);
    spend = new SpendCapService(
      dataSource,
      plans,
      audit,
      new UsageEventService(dataSource),
      alerts,
    );
    limits = new LimitsService(dataSource, plans, spend);
    views = new PlanViewService(dataSource, plans, spend, audit);
  });
  afterAll(() => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE seats, subscriptions, usage_counters, usage_counter_hits, customer_activity, spend_periods, billing_audit CASCADE`,
    );
    await dataSource.query(
      `DELETE FROM seat_types WHERE key NOT IN ('basic','premium')`,
    );
    await dataSource.query(`DELETE FROM users WHERE email LIKE 'cr1-%'`);
    await dataSource.query(`DELETE FROM tenants WHERE code LIKE 'cr1-%'`);
    const [tenant] = await dataSource.query(
      `INSERT INTO tenants (name, code) SELECT 'CR1 org ' || x, 'cr1-' || x FROM (SELECT floor(random()*1e9)::text AS x) r RETURNING id`,
    );
    [{ id: creator }] = await dataSource.query(
      `INSERT INTO users (email, name, username, status, tenant_id) VALUES ('cr1-owner@test.local', 'Asha Owner', 'cr1-owner', 'ACTIVE', $1) RETURNING id`,
      [tenant.id],
    );
    // A creator: they've started an assistant (a draft counts against nothing).
    await dataSource.query(
      `INSERT INTO chatbots (name, created_by, status) VALUES ('Draft', $1, 'draft')`,
      [creator],
    );
  });

  const bot = async (status: 'live' | 'draft' = 'live', name = 'Bot') => {
    const [row] = await dataSource.query(
      `INSERT INTO chatbots (name, created_by, status) VALUES ($1, $2, $3) RETURNING id`,
      [name, creator, status],
    );
    await dataSource.query(
      `INSERT INTO chatbot_members (chatbot_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [row.id, creator],
    );
    return row.id as string;
  };

  const invite = async (chatbotId: string, ...emails: string[]) => {
    const [page] = await dataSource.query(
      `INSERT INTO chatbot_pages (chatbot_id, slug, status, access) VALUES ($1, $2, 'on', 'invite')
       ON CONFLICT DO NOTHING RETURNING id`,
      [chatbotId, `cr1-${chatbotId.slice(0, 8)}`],
    );
    const pageId =
      page?.id ??
      (
        await dataSource.query(
          `SELECT id FROM chatbot_pages WHERE chatbot_id = $1`,
          [chatbotId],
        )
      )[0].id;
    for (const email of emails) {
      await dataSource.query(
        `INSERT INTO chatbot_page_access (page_id, kind, value) VALUES ($1, 'email', $2)`,
        [pageId, email],
      );
    }
  };

  /** What the creator's assistants have cost so far this period, as usage events would leave it. */
  const spent = async (micros: number) => {
    const { period } = await spend.state(creator);
    await dataSource.query(
      `INSERT INTO spend_periods ("userId", "periodStart", "periodEnd", "costMicros") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", "periodStart") DO UPDATE SET "costMicros" = EXCLUDED."costMicros"`,
      [creator, period.start, period.end, micros],
    );
  };

  let run = 0;
  const seatTurn = (chatbotId: string, email: string) =>
    limits.checkTurn({
      chatbotId,
      creatorUserId: creator,
      conversationKey: `conv-${email}`,
      context: {
        channel: UsageChannel.BOT_PAGE,
        runKind: UsageKind.CUSTOMER_REPLY,
        audience: 'seat',
        seatEmail: email,
        runId: `r${++run}`,
      },
    });
  const customerTurn = (chatbotId: string, key: string, runId = `r${++run}`) =>
    limits.checkTurn({
      chatbotId,
      creatorUserId: creator,
      conversationKey: key,
      context: {
        channel: UsageChannel.WHATSAPP,
        runKind: UsageKind.CUSTOMER_REPLY,
        runId,
      },
    });

  it('dates: months clamp, and periods follow the anchor day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(periodFor('2026-10-15', new Date('2026-11-19T10:00:00Z'))).toEqual({
      start: '2026-11-15',
      end: '2026-12-15',
    });
    expect(periodFor('2026-10-20', new Date('2026-11-19T10:00:00Z'))).toEqual({
      start: '2026-10-20',
      end: '2026-11-20',
    });
  });

  it('a Free creator can’t publish a 4th assistant; lowering a plan never unpublishes', async () => {
    await plans.setPlan(creator, { planKey: 'free', note: 'Start' }, 9);
    for (const n of [1, 2, 3]) await bot('live', `B${n}`);
    const fourth = await bot('draft', 'B4');
    await expect(plans.assertCanPublish(fourth)).rejects.toThrow(
      'Free publishes up to 3 assistants. Ask Ally about Pro.',
    );
    expect(await plans.publishUse(fourth)).toMatchObject({
      canPublish: false,
      published: 3,
      maxPublished: 3,
    });

    await plans.setPlan(creator, { planKey: 'pro', note: 'Upgrade' }, 9);
    await expect(plans.assertCanPublish(fourth)).resolves.toBeUndefined();
    await dataSource.query(
      `UPDATE chatbots SET status = 'live' WHERE id = $1`,
      [fourth],
    );
    await plans.setPlan(creator, { planKey: 'free', note: 'Downgrade' }, 9);
    expect(await plans.publishedCount(creator)).toBe(4); // nothing unpublished
    await expect(
      plans.assertCanPublish(await bot('draft', 'B5')),
    ).rejects.toThrow('Free publishes');
  });

  it('only chatbot creators have a plan', async () => {
    const [{ id: other }] = await dataSource.query(
      `INSERT INTO users (email, name, username, status, tenant_id) SELECT 'cr1-x@test.local', 'X', 'cr1-x', 'ACTIVE', tenant_id FROM users WHERE id = $1 RETURNING id`,
      [creator],
    );
    await expect(
      plans.setPlan(other, { planKey: 'pro', note: 'No' }, 9),
    ).rejects.toThrow('Only chatbot creators');
  });

  it('included seats go to owners, then invitees; the rest are strict', async () => {
    await plans.setPlan(creator, { planKey: 'pro', note: 'Start' }, 9);
    const id = await bot();
    await invite(
      id,
      'a@x.test',
      'b@x.test',
      'c@x.test',
      'd@x.test',
      'e@x.test',
    );
    await plans.ensureIncludedSeats(id);
    await plans.ensureIncludedSeats(id); // idempotent
    const seats = await plans.seatsOf(id);
    expect(seats).toHaveLength(5);
    expect(seats.map((s) => s.assigneeEmail)).toEqual([
      'cr1-owner@test.local',
      'a@x.test',
      'b@x.test',
      'c@x.test',
      'd@x.test',
    ]);

    expect(await seatTurn(id, 'a@x.test')).toBeNull();
    expect(await seatTurn(id, 'e@x.test')).toBe('no_seat');
  });

  it('assigning and moving a seat', async () => {
    await plans.setPlan(creator, { planKey: 'pro', note: 'Start' }, 9);
    const id = await bot();
    await invite(id, 'a@x.test', 'b@x.test');
    const [extra] = await plans.addSeats(
      id,
      { seatTypeKey: 'premium', count: 1, note: 'One more' },
      9,
    );
    await plans.assignSeat(id, extra.id, 'a@x.test', creator);
    expect(await seatTurn(id, 'a@x.test')).toBeNull();
    await plans.assignSeat(id, extra.id, 'b@x.test', creator); // moved
    expect(await seatTurn(id, 'a@x.test')).toBe('no_seat');
    expect(await seatTurn(id, 'b@x.test')).toBeNull();
    await expect(
      plans.assignSeat(id, extra.id, 'stranger@x.test', creator),
    ).rejects.toThrow('Invite this person');
  });

  it('a seat’s messages count once per run and stop at its limit', async () => {
    await plans.setPlan(creator, { planKey: 'pro', note: 'Start' }, 9);
    await dataSource.query(
      `UPDATE seat_types SET "messagesPerMonth" = 2 WHERE key = 'basic'`,
    );
    try {
      const id = await bot();
      await invite(id, 'a@x.test');
      await plans.ensureIncludedSeats(id);
      const ctx = (runId: string) => ({
        channel: UsageChannel.BOT_PAGE,
        runKind: UsageKind.CUSTOMER_REPLY,
        audience: 'seat' as const,
        seatEmail: 'a@x.test',
        runId,
      });
      const check = (runId: string) =>
        limits.checkTurn({
          chatbotId: id,
          creatorUserId: creator,
          conversationKey: 'c',
          context: ctx(runId),
        });
      expect(await check('m1')).toBeNull();
      expect(await check('m1')).toBeNull(); // a redelivery doesn't count again
      expect(await check('m2')).toBeNull();
      expect(await check('m3')).toBe('seat_messages');
    } finally {
      await dataSource.query(
        `UPDATE seat_types SET "messagesPerMonth" = 500 WHERE key = 'basic'`,
      );
    }
  });

  it('each extra seat renews on its own date; a lapsed seat stops chat but keeps membership', async () => {
    await plans.setPlan(creator, { planKey: 'pro', note: 'Start' }, 9);
    const id = await bot();
    await invite(id, 'a@x.test', 'b@x.test');
    const [early] = await plans.addSeats(
      id,
      { seatTypeKey: 'basic', count: 1, startDate: '2026-10-05', note: 'A' },
      9,
    );
    const [late] = await plans.addSeats(
      id,
      { seatTypeKey: 'basic', count: 1, startDate: '2026-10-25', note: 'B' },
      9,
    );
    await plans.assignSeat(id, early.id, 'a@x.test', creator);
    await plans.assignSeat(id, late.id, 'b@x.test', creator);

    await plans.renewSeats(new Date('2026-11-06T00:00:00Z'));
    const after = Object.fromEntries(
      (await plans.seatsOf(id)).map((s) => [s.id, dayString(s.nextRenewal)]),
    );
    expect(after[early.id]).toMatch(/2026-12-05/);
    expect(after[late.id]).toMatch(/2026-11-25/);

    await plans.setPlan(
      creator,
      { planKey: 'pro', status: 'past_due' as never, note: 'Unpaid' },
      9,
    );
    const result = await plans.renewSeats(new Date('2026-11-26T00:00:00Z'));
    expect(result.lapsed).toBe(1);
    expect(await seatTurn(id, 'b@x.test')).toBe('no_seat');
    const [member] = await dataSource.query(
      `SELECT count(*) AS n FROM chatbot_page_access WHERE value = 'b@x.test'`,
    );
    expect(Number(member.n)).toBe(1); // still invited
    await plans.renewSeat(late.id, 'Paid', 9);
    expect(await seatTurn(id, 'b@x.test')).toBeNull();
  });

  it('a new seat type added on the Plans screen works with no code change', async () => {
    await plans.setPlan(creator, { planKey: 'pro', note: 'Start' }, 9);
    await plans.saveSeatType(
      { name: 'Unlimited desk', messagesPerMonth: null, note: 'For a pilot' },
      9,
    );
    const id = await bot();
    await invite(id, 'a@x.test');
    const [seat] = await plans.addSeats(
      id,
      { seatTypeKey: 'unlimited_desk', count: 1, note: 'Pilot' },
      9,
    );
    await plans.assignSeat(id, seat.id, 'a@x.test', creator);
    for (let i = 0; i < 5; i += 1)
      expect(await seatTurn(id, 'a@x.test')).toBeNull();
  });

  it('customers: a new conversation after 24 hours counts; the allowance stops new ones only', async () => {
    await plans.setPlan(creator, { planKey: 'free', note: 'Start' }, 9);
    await dataSource.query(
      `UPDATE plans SET "customerConversations" = 2 WHERE key = 'free'`,
    );
    try {
      const id = await bot();
      expect(await customerTurn(id, 'p1')).toBeNull();
      expect(await customerTurn(id, 'p1')).toBeNull(); // same conversation
      expect(await customerTurn(id, 'p2')).toBeNull();
      expect(await customerTurn(id, 'p3')).toBe('customers'); // a 3rd new one
      expect(await customerTurn(id, 'p3')).toBe('customers'); // still refused: never recorded
      expect(await customerTurn(id, 'p1')).toBeNull(); // an ongoing one goes on
      await dataSource.query(
        `UPDATE customer_activity SET "lastMessageAt" = now() - interval '25 hours' WHERE "conversationKey" = 'p1'`,
      );
      expect(await customerTurn(id, 'p1')).toBe('customers'); // a new conversation after the gap
      const [counter] = await dataSource.query(
        `SELECT count, "alerted80At", "alerted100At" FROM usage_counters WHERE "subjectType" = 'customers'`,
      );
      expect(counter.count).toBe(2);
      expect(counter.alerted80At).not.toBeNull();
      expect(counter.alerted100At).not.toBeNull();
    } finally {
      await dataSource.query(
        `UPDATE plans SET "customerConversations" = 300 WHERE key = 'free'`,
      );
    }
  });

  it('owner-side runs: refused with the owner message at the limit; the cost cap first', async () => {
    await plans.setPlan(creator, { planKey: 'free', note: 'Start' }, 9);
    await dataSource.query(
      `UPDATE plans SET "ownerRuns" = 1 WHERE key = 'free'`,
    );
    try {
      await bot();
      await limits.assertOwnerRun(creator, 'setup-1', 'setup');
      await limits.assertOwnerRun(creator, 'setup-1', 'setup'); // the same run again
      await expect(
        limits.assertOwnerRun(creator, 'setup-2', 'setup'),
      ).rejects.toThrow(
        "Your plan's monthly limit for setup and checkups is used up. Ask Ally to upgrade.",
      );
      await dataSource.query(
        `UPDATE plans SET "costCapMicros" = 2000000 WHERE key = 'free'`,
      );
      await spent(2_000_000);
      await expect(
        limits.assertOwnerRun(creator, 'setup-3', 'setup'),
      ).rejects.toThrow(
        "Your account has reached this month's usage limit. Ask Ally to raise it.",
      );
    } finally {
      await dataSource.query(
        `UPDATE plans SET "ownerRuns" = 100, "costCapMicros" = NULL WHERE key = 'free'`,
      );
    }
  });

  it('customers and invited people get the fixed reply when the creator’s cost cap is reached', async () => {
    await plans.setPlan(creator, { planKey: 'pro', note: 'Start' }, 9);
    const id = await bot();
    await plans.ensureIncludedSeats(id);
    await dataSource.query(
      `UPDATE plans SET "costCapMicros" = 5000000 WHERE key = 'pro'`,
    );
    try {
      await spent(4_999_999);
      expect(await customerTurn(id, 'p1')).toBeNull();
      await spent(5_000_000);
      expect(await customerTurn(id, 'p2')).toBe('customers');
      expect(await seatTurn(id, 'cr1-owner@test.local')).toBe('customers');
    } finally {
      await dataSource.query(
        `UPDATE plans SET "costCapMicros" = NULL WHERE key = 'pro'`,
      );
    }
  });

  it('counters reset on the plan’s day', async () => {
    await plans.setPlan(
      creator,
      { planKey: 'free', periodStart: '2026-10-10', note: 'Start' },
      9,
    );
    const { anchor } = await plans.planOf(creator);
    expect(periodFor(anchor, new Date('2026-11-09T12:00:00Z')).start).toBe(
      '2026-10-10',
    );
    expect(periodFor(anchor, new Date('2026-11-10T00:00:00Z')).start).toBe(
      '2026-11-10',
    );
  });

  it('the owner sees their monthly usage in dollars, warned at 80% and told when it is used up', async () => {
    await plans.setPlan(creator, { planKey: 'pro', note: 'Start' }, 9);
    await bot();
    expect(await views.forUser(creator)).toMatchObject({
      monthlyUsage: null,
      capReached: false,
    });
    await dataSource.query(
      `UPDATE plans SET "costCapMicros" = 10000000 WHERE key = 'pro'`,
    );
    try {
      await spent(6_200_000);
      const part = await views.forUser(creator);
      expect(part).toMatchObject({
        capReached: false,
        monthlyUsage: { used: 6.2, limit: 10 },
      });
      expect(part.alerts).toEqual([]);

      await spent(8_400_000);
      expect((await views.forUser(creator)).alerts).toEqual([
        { what: 'Monthly usage', percent: 84 },
      ]);

      await spent(10_600_000);
      const full = await views.forUser(creator);
      expect(full).toMatchObject({
        capReached: true,
        monthlyUsage: { used: 10.6, limit: 10 },
      });
      expect(full.alerts).toEqual([{ what: 'Monthly usage', percent: 100 }]);
    } finally {
      await dataSource.query(
        `UPDATE plans SET "costCapMicros" = NULL WHERE key = 'pro'`,
      );
    }
  });

  it('internal: nothing limited, and invited people need no seat', async () => {
    await plans.setPlan(creator, { planKey: 'internal', note: 'Ally team' }, 9);
    const id = await bot();
    await invite(id, 'anyone@x.test');
    expect(await seatTurn(id, 'anyone@x.test')).toBeNull();
    for (let i = 0; i < 5; i += 1)
      expect(await customerTurn(id, `p${i}`)).toBeNull();
  });
});
