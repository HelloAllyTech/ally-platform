import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../whatsapp/shared-store/test/shared-store.pg';
import { CostAlertKind, UsageChannel, UsageKind } from '../enum/billing.enum';
import { BillingAuditService } from '../service/billing-audit.service';
import { PlanService, addMonths, periodFor } from '../service/plan.service';
import { SpendCapService } from '../service/spend-cap.service';
import { UsageEventService } from '../service/usage-event.service';
import { BILLING_ENTITIES } from './billing-entities';

/**
 * The spend cap on real Postgres: cost counted once per event into the creator's plan period, the
 * cap from the plan or the creator's own, never capped, Ally told at 80% and 100% once each, and
 * the nightly correction from the events.
 */
describePg('Billing: spend cap (Postgres)', () => {
  let dataSource: DataSource;
  let usage: UsageEventService;
  let plans: PlanService;
  let spend: SpendCapService;
  let bot: string;
  const USER = 1; // seedChatbot's creator
  const fired: Array<{ kind: string; subject: string; message: string }> = [];
  const emails: Array<{ to: string; subject: string; body: string }> = [];

  beforeAll(async () => {
    dataSource = await openTestDataSource(BILLING_ENTITIES);
    usage = new UsageEventService(dataSource);
    const audit = new BillingAuditService(dataSource);
    const alerts = {
      fire: async (
        kind: string,
        subject: string,
        _now: Date,
        message: string,
      ) => {
        fired.push({ kind, subject, message });
        return true;
      },
    } as never;
    plans = new PlanService(dataSource, audit, alerts);
    spend = new SpendCapService(dataSource, plans, audit, usage, alerts, {
      sendEmail: async (email: {
        to: string;
        subject: string;
        body: string;
      }) => {
        emails.push(email);
        return true;
      },
    } as never);
    usage.addListener(spend);
  });
  afterAll(() => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE usage_events, billing_audit, spend_periods, subscriptions CASCADE`,
    );
    await dataSource.query(`UPDATE plans SET "costCapMicros" = NULL`);
    fired.length = 0;
    emails.length = 0;
    bot = await seedChatbot(dataSource);
  });

  const planCap = (usd: number | null, key = 'free') =>
    dataSource.query(`UPDATE plans SET "costCapMicros" = $1 WHERE key = $2`, [
      usd === null ? null : usd * 1_000_000,
      key,
    ]);

  let run = 0;
  /** One priced call on the creator's assistant. */
  const cost = (usd: number, at?: Date, runId = `spend-${++run}`) =>
    usage.record({
      runId,
      kind: UsageKind.CUSTOMER_REPLY,
      channel: UsageChannel.BOT_PAGE,
      chatbotId: bot,
      fixedCostMicros: usd * 1_000_000,
      occurredAt: at,
    });

  /** Notices go out after the event's transaction, on the next turn of the loop. */
  const settled = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  it('counts cost with no cap, and never stops anyone', async () => {
    await cost(3);
    await cost(4.5);
    expect(await spend.state(USER)).toMatchObject({
      usedMicros: 7_500_000,
      capMicros: null,
      capSource: 'none',
    });
    expect(await spend.isOverCap(USER)).toBe(false);
    await settled();
    expect(fired).toHaveLength(0);
  });

  it('counts a redelivered event once, and ignores unpriced ones', async () => {
    await cost(2, undefined, 'same-run');
    await cost(2, undefined, 'same-run');
    await usage.record({
      runId: 'unpriced',
      kind: UsageKind.CUSTOMER_REPLY,
      channel: UsageChannel.BOT_PAGE,
      chatbotId: bot,
      fixedCostMicros: null,
    });
    expect((await spend.state(USER)).usedMicros).toBe(2_000_000);
  });

  it('stops at the plan’s cap, not before', async () => {
    await planCap(10);
    await cost(9.99);
    expect(await spend.isOverCap(USER)).toBe(false);
    await cost(0.01);
    expect(await spend.state(USER)).toMatchObject({
      usedMicros: 10_000_000,
      capMicros: 10_000_000,
      capSource: 'plan',
    });
    expect(await spend.isOverCap(USER)).toBe(true);
  });

  it('tells Ally at 80% and at 100%, once each, and the owner at 100% with no amount', async () => {
    await dataSource.query(
      `UPDATE users SET email = coalesce(email, 'creator-one@test.local') WHERE id = $1`,
      [USER],
    );
    await planCap(10);
    await cost(7.9);
    await settled();
    expect(fired).toHaveLength(0);
    await cost(0.2);
    await settled();
    expect(fired).toHaveLength(1);
    expect(fired[0].kind).toBe(CostAlertKind.SPEND_CAP);
    expect(fired[0].message).toContain('80%');
    expect(emails).toHaveLength(0);
    await cost(0.5);
    await settled();
    expect(fired).toHaveLength(1);
    await cost(2);
    await cost(1);
    await settled();
    expect(fired).toHaveLength(2);
    expect(fired[1].message).toContain('$10.60 of $10.00');
    const [user] = await dataSource.query(
      `SELECT email FROM users WHERE id = $1`,
      [USER],
    );
    if (user?.email) {
      expect(emails).toHaveLength(1);
      expect(emails[0].subject).toBe(
        "Your Ally plan: this month's usage limit is reached",
      );
      expect(emails[0].body).not.toContain('$');
    }
  });

  it('a creator’s own cap wins over the plan’s; "never capped" wins over both', async () => {
    await planCap(1);
    await cost(5);
    expect(await spend.isOverCap(USER)).toBe(true);

    const own = await spend.setCap(USER, { capUsd: 20, note: 'Pilot' }, 9);
    expect(own).toMatchObject({
      usedUsd: 5,
      capUsd: 20,
      capSource: 'own',
      planCapUsd: 1,
    });
    expect(await spend.isOverCap(USER)).toBe(false);

    const off = await spend.setCap(USER, { off: true, note: 'Ally team' }, 9);
    expect(off).toMatchObject({ capUsd: null, capSource: 'off' });
    await cost(500);
    expect(await spend.isOverCap(USER)).toBe(false);

    const back = await spend.setCap(USER, { note: 'Back to the plan' }, 9);
    expect(back).toMatchObject({ capUsd: 1, capSource: 'plan' });
    expect(await spend.isOverCap(USER)).toBe(true);
    expect(back.history.map((row) => row.action)).toEqual(
      expect.arrayContaining(['set', 'off', 'plan']),
    );
  });

  it('setting a cap keeps the creator’s plan and reset day, and needs a note', async () => {
    const before = await plans.planOf(USER);
    await spend.setCap(USER, { capUsd: 3, note: 'First cap' }, 9);
    const after = await plans.planOf(USER);
    expect(after.plan.key).toBe(before.plan.key);
    expect(after.anchor).toBe(before.anchor);
    expect(after.subscription?.costCapMicros).toBe(3_000_000);
    await expect(
      spend.setCap(USER, { capUsd: 3, note: '' }, 9),
    ).rejects.toThrow();
    await expect(
      spend.setCap(USER, { capUsd: 0, note: 'Zero' }, 9),
    ).rejects.toThrow('A cost cap must be more than $0');
  });

  it('a raised cap is a new line: Ally hears again when it is reached', async () => {
    await planCap(1);
    await cost(1);
    await settled();
    expect(fired).toHaveLength(1);
    await spend.setCap(USER, { capUsd: 2, note: 'Raised' }, 9);
    await cost(1);
    await settled();
    expect(fired).toHaveLength(2);
    expect(fired[1].message).toContain('$2.00 of $2.00');
  });

  it('cost lands in the period it happened in', async () => {
    await planCap(1);
    await plans.setPlan(
      USER,
      {
        planKey: 'free',
        periodStart: addMonths(new Date().toISOString().slice(0, 10), -3),
        note: 'Three months in',
      },
      9,
    );
    const { anchor } = await plans.planOf(USER);
    const current = periodFor(anchor);
    const lastMonth = new Date(`${addMonths(current.start, -1)}T12:00:00Z`);
    await cost(50, lastMonth);
    expect((await spend.state(USER)).usedMicros).toBe(0);
    expect(await spend.isOverCap(USER)).toBe(false);
  });

  it('the nightly check sets a period to what its events add up to', async () => {
    await cost(4);
    await dataSource.query(
      `UPDATE spend_periods SET "costMicros" = 1 WHERE "userId" = $1`,
      [USER],
    );
    expect(await spend.reconcile()).toBe(1);
    expect((await spend.state(USER)).usedMicros).toBe(4_000_000);
    expect(await spend.reconcile()).toBe(0);
  });

  it('the admin summary says where the period’s cost went', async () => {
    await cost(1.25);
    await cost(0.75);
    const summary = await spend.summary(USER);
    expect(summary.usedUsd).toBe(2);
    expect(summary.usage.byAssistant).toEqual([
      expect.objectContaining({ chatbotId: bot, costUsd: 2 }),
    ]);
    expect(summary.usage.byKind).toEqual([
      expect.objectContaining({ kind: 'customer_reply', costUsd: 2 }),
    ]);
  });
});
