import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../whatsapp/shared-store/test/shared-store.pg';
import { UsageChannel, UsageKind } from '../enum/billing.enum';
import { BillingAuditService } from '../service/billing-audit.service';
import { CreditWarningService } from '../service/credit-warning.service';
import { CreditsCutoverService } from '../service/credits-cutover.service';
import { EndPersonService } from '../service/end-person.service';
import { LedgerService } from '../service/ledger.service';
import { LimitsService } from '../service/limits.service';
import {
  USAGE_EVENT_UNPRICED,
  UsageEventService,
} from '../service/usage-event.service';
import { BILLING_ENTITIES } from './billing-entities';

const USD = 1_000_000;

/**
 * The stage 6 credits ledger on real Postgres (plan section 6, stage 6 rows): reservations are
 * one conditional UPDATE so concurrent turns cannot overshoot, settlement from recorded usage,
 * the unpriced fallback, a stopped usage feed and a missing payer block, the ledger edges
 * (lowering, archive, transfer, adjustments), one person by phone and email counted once, R2
 * (building never touches set-aside budgets), the warning emails and the nightly rebuild.
 */
describePg('Billing: credits ledger (Postgres)', () => {
  let dataSource: DataSource;
  let usage: UsageEventService;
  let ledger: LedgerService;
  let persons: EndPersonService;
  let limits: LimitsService;
  let bot: string;
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const emails: Array<{ to: string; subject: string }> = [];

  beforeAll(async () => {
    dataSource = await openTestDataSource(BILLING_ENTITIES);
    usage = new UsageEventService(dataSource, {
      emit: (name: string, payload: unknown) => emitted.push({ name, payload }),
    } as never);
    ledger = new LedgerService(
      dataSource,
      usage,
      new BillingAuditService(dataSource),
    );
    usage.addListener(ledger);
    persons = new EndPersonService(dataSource);
    limits = new LimitsService(
      dataSource,
      {} as never,
      {} as never,
      undefined,
      ledger,
      persons,
    );
  });
  afterAll(() => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE usage_events, billing_audit, cost_alerts, credit_grants, chatbot_budgets,
                credit_reservations, end_person_spend, end_person_identities, end_persons,
                credit_warnings, credit_paused_jobs, billing_accounts, users CASCADE`,
    );
    await dataSource.query(
      `INSERT INTO users (id, email, name, status, username, tenant_id)
       VALUES (1, 'one@example.test', 'One', 'active', 'one', 't1'),
              (2, 'two@example.test', 'Two', 'active', 'two', 't1')`,
    );
    bot = await seedChatbot(dataSource); // created_by = 1
    ledger.invalidate();
    emitted.length = 0;
    emails.length = 0;
  });

  const grant = (userId: number, usd: number) =>
    ledger.grant({ userId, amountUsd: usd, kind: 'grant', note: 'test' }, 99);
  const accountOf = async (userId: number) =>
    (await ledger.findAccount(userId))!;
  const free = async (userId: number) =>
    ledger.freeBalanceOf(await accountOf(userId));
  let run = 0;
  const spend = (micros: number, over: Record<string, unknown> = {}) =>
    usage.record({
      runId: `spend-${++run}`,
      kind: UsageKind.CUSTOMER_REPLY,
      channel: UsageChannel.WHATSAPP,
      chatbotId: bot,
      fixedCostMicros: micros,
      ...over,
    } as never);
  const customerTurn = (
    runId: string,
    sender?: { phone?: string; email?: string },
  ) =>
    limits.checkTurn({
      chatbotId: bot,
      creatorUserId: 1,
      conversationKey: 'c1',
      context: {
        runId,
        chatbotId: bot,
        channel: UsageChannel.WHATSAPP,
        runKind: UsageKind.CUSTOMER_REPLY,
      },
      sender,
      userLimits: null,
    });

  it('concurrent turns cannot overshoot a small budget', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 0.05, 1);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        ledger.reserve({
          runId: `race-${i}`,
          funding: 'budget',
          estimateMicros: 20_000,
          chatbotId: bot,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(
      results
        .filter((r) => !r.ok)
        .every((r) => !r.ok && r.reason === 'budget_empty'),
    ).toBe(true);
    const budget = await ledger.openBudget(bot);
    expect(budget!.reserved).toBe(40_000);
    expect(budget!.setAside - budget!.reserved).toBeGreaterThanOrEqual(0);
  });

  it('a retried message reuses its reservation', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 1, 1);
    const a = await ledger.reserve({
      runId: 'wamid.x',
      funding: 'budget',
      estimateMicros: 20_000,
      chatbotId: bot,
    });
    const b = await ledger.reserve({
      runId: 'wamid.x',
      funding: 'budget',
      estimateMicros: 20_000,
      chatbotId: bot,
    });
    expect(b).toMatchObject({ ok: true, reused: true });
    expect(a.ok && b.ok && a.reservationId === b.reservationId).toBe(true);
    expect((await ledger.openBudget(bot))!.reserved).toBe(20_000);
  });

  it('usage recorded for a run settles its reservation, and the sweep releases the rest', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 1, 1);
    expect(await customerTurn('run-1')).toBeNull();
    await usage.record({
      runId: 'run-1',
      kind: UsageKind.CUSTOMER_REPLY,
      channel: UsageChannel.WHATSAPP,
      chatbotId: bot,
      fixedCostMicros: 5_000,
    } as never);
    let budget = (await ledger.openBudget(bot))!;
    expect(budget.spent).toBe(5_000);
    expect(budget.reserved).toBe(15_000);
    const [event] = await dataSource.query(
      `SELECT "payerAccountId", funding FROM usage_events`,
    );
    expect(event).toEqual({
      payerAccountId: await accountOf(1),
      funding: 'budget',
    });

    await ledger.releaseExpired(new Date(Date.now() + 11 * 60_000));
    budget = (await ledger.openBudget(bot))!;
    expect(budget.reserved).toBe(0);
    const [res] = await dataSource.query(
      `SELECT state FROM credit_reservations WHERE run_id = 'run-1'`,
    );
    expect(res.state).toBe('settled');
  });

  it('an unpriced model is charged a pessimistic fallback and raises the alert', async () => {
    await grant(1, 10);
    await usage.record({
      runId: 'owner-1',
      kind: UsageKind.TRY_IT,
      channel: UsageChannel.OWNER,
      chatbotId: bot,
      provider: 'openai',
      model: 'mystery-model-9',
      inputTokens: 1000,
      outputTokens: 1000,
    } as never);
    const [event] = await dataSource.query(
      `SELECT "costMicros", "chargedMicros", funding FROM usage_events`,
    );
    expect(event.costMicros).toBeNull();
    expect(Number(event.chargedMicros)).toBe(90_000);
    expect(event.funding).toBe('free');
    expect(await free(1)).toBe(10 * USD - 90_000);
    expect(emitted.some((e) => e.name === USAGE_EVENT_UNPRICED)).toBe(true);
  });

  it("the Credits page counts the builder's own work in used and every breakdown", async () => {
    await grant(1, 20);
    // A held Try it turn is set aside, not used, until its usage is recorded.
    expect(
      await limits.checkTurn({
        chatbotId: bot,
        creatorUserId: 1,
        conversationKey: null,
        context: {
          runId: 'try-held',
          chatbotId: bot,
          channel: UsageChannel.OWNER,
          runKind: UsageKind.TRY_IT,
        },
      }),
    ).toBeNull();
    let page = await ledger.creditsFor(1);
    expect(page.usedUsd).toBe(0);
    expect(page.reservedUsd).toBeGreaterThan(0);
    expect(page.freeBalanceUsd).toBeLessThan(20);

    // The Try it turn's usage arrives and settles; a draft's likely-questions checkup (no chatbot
    // id on the event) and a customer turn on a budget follow.
    await usage.record({
      runId: 'try-held',
      kind: UsageKind.TRY_IT,
      channel: UsageChannel.OWNER,
      chatbotId: bot,
      fixedCostMicros: 15_000,
    } as never);
    const [draft] = await dataSource.query(
      `INSERT INTO bot_drafts (owner_user_id, chatbot_id, draft_config) VALUES (1, $1, '{}') RETURNING id`,
      [bot],
    );
    await usage.record({
      runId: 'likely-1',
      kind: UsageKind.CHECKUP,
      channel: UsageChannel.OWNER,
      draftId: draft.id,
      creatorUserId: 1,
      fixedCostMicros: 5_000,
    } as never);
    await ledger.setBudget(bot, 1, 1);
    await spend(30_000);
    // The turn ends: what it held and didn't use goes back.
    await ledger.release('try-held');

    page = await ledger.creditsFor(1);
    expect(page.builderSpentUsd).toBe(0.02);
    expect(page.customerSpentUsd).toBe(0.03);
    expect(page.usedUsd).toBe(0.05);
    expect(page.reservedUsd).toBe(0);
    expect(page.freeBalanceUsd).toBe(20 - 1 - 0.02);
    expect(page.spendByKind).toEqual(
      expect.arrayContaining([
        { kind: UsageKind.TRY_IT, costUsd: 0.015 },
        { kind: UsageKind.CHECKUP, costUsd: 0.005 },
        { kind: UsageKind.CUSTOMER_REPLY, costUsd: 0.03 },
      ]),
    );
    expect(page.spendByTask.length).toBeGreaterThanOrEqual(3);
    // The draft's work counts under its chatbot, named even before it had a budget.
    expect(page.spendByChatbot).toEqual([
      { chatbotId: bot, name: 'Test bot', costUsd: 0.05 },
    ]);
    expect(page.spendByDay).toEqual([
      { day: expect.any(String), costUsd: 0.05 },
    ]);
  });

  it('a stopped usage feed blocks new spend', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 1, 1);
    await dataSource.query(
      `INSERT INTO cost_alerts (kind, "subjectKey", day, detail) VALUES ('usage_feed_off', 'ally-ai', $1, '{}')`,
      [new Date().toISOString().slice(0, 10)],
    );
    ledger.invalidate();
    // The block is on in production only, or where the switch turns it on (ledger.service.ts).
    const before = process.env.ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF;
    process.env.ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF = 'true';
    try {
      expect(await customerTurn('run-feed')).toBe('out_of_credits');
      expect((await ledger.openBudget(bot))!.reserved).toBe(0);
    } finally {
      if (before === undefined)
        delete process.env.ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF;
      else process.env.ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF = before;
    }
  });

  it('a missing payer counts as blocked, never as free', async () => {
    // No budget was ever set for this chatbot: its customers have no payer.
    expect(await customerTurn('run-nopayer')).toBe('out_of_credits');
    const result = await ledger.reserve({
      runId: 'x',
      funding: 'budget',
      estimateMicros: 1,
      chatbotId: bot,
    });
    expect(result).toEqual({ ok: false, reason: 'no_payer', accountId: null });
    // A chatbot nobody created: no one pays for testing it either.
    const [orphan] = await dataSource
      .query(
        `INSERT INTO chatbots (name, created_by, status) VALUES ('orphan', NULL, 'live') RETURNING id`,
      )
      .catch(async () => [{ id: null }]);
    if (orphan.id) {
      const owner = await ledger.reserve({
        runId: 'y',
        funding: 'free',
        estimateMicros: 1,
        chatbotId: orphan.id,
      });
      expect(owner).toMatchObject({ ok: false, reason: 'no_payer' });
    }
  });

  it('building never touches what is set aside for live chatbots (R2)', async () => {
    await grant(1, 1);
    await ledger.setBudget(bot, 1, 1);
    const building = await ledger.reserve({
      runId: 'try-1',
      funding: 'free',
      estimateMicros: 20_000,
      chatbotId: bot,
    });
    expect(building).toMatchObject({ ok: false, reason: 'free_balance_empty' });
    const customer = await ledger.reserve({
      runId: 'cust-1',
      funding: 'budget',
      estimateMicros: 20_000,
      chatbotId: bot,
    });
    expect(customer.ok).toBe(true);
  });

  it('lowering a budget below what it spent is clamped at the spent amount', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 1, 1);
    await spend(600_000);
    const result = await ledger.setBudget(bot, 0.2, 1);
    expect(result).toMatchObject({ setAsideMicros: 600_000, clamped: true });
    expect(await free(1)).toBe(10 * USD - 600_000);
  });

  it('raising a budget past the free balance is refused, and a low free balance warns', async () => {
    await grant(1, 6);
    await expect(ledger.setBudget(bot, 7, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const result = await ledger.setBudget(bot, 2, 1);
    expect(result.warning).toMatch(/under the \$5\.00/);
  });

  it('archiving returns the unspent budget to the free balance', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 2, 1);
    await spend(500_000);
    const { returnedMicros } = await ledger.archiveBudget(bot);
    expect(returnedMicros).toBe(1_500_000);
    expect(await free(1)).toBe(10 * USD - 500_000);
    expect(await ledger.openBudget(bot)).toBeNull();
  });

  it('a transfer needs the receiving account’s free balance', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 2, 1);
    await expect(
      ledger.transferBudget(bot, { userId: 2 }, 99),
    ).rejects.toBeInstanceOf(ConflictException);
    await grant(2, 5);
    const moved = await ledger.transferBudget(bot, { userId: 2 }, 99);
    expect(moved.movedMicros).toBe(2 * USD);
    expect(await free(1)).toBe(10 * USD);
    expect(await free(2)).toBe(3 * USD);
    expect((await ledger.openBudget(bot))!.accountId).toBe(await accountOf(2));
    expect(await ledger.removalBlockedReason(bot, 1)).toBeNull();
    expect(await ledger.removalBlockedReason(bot, 2)).toMatch(
      /Move the budget/,
    );
  });

  it('a negative adjustment cannot go below spent plus set aside', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 4, 1);
    await ledger.grant(
      { userId: 1, amountUsd: 0.5, kind: 'grant', note: 'x' },
      99,
    );
    await expect(
      ledger.grant(
        { userId: 1, amountUsd: -7, kind: 'adjustment', note: 'too much' },
        99,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await ledger.grant(
      { userId: 1, amountUsd: -6, kind: 'adjustment', note: 'ok' },
      99,
    );
    expect(await free(1)).toBe(0.5 * USD);
  });

  it('the same person by phone and by email counts once against the per-user limits', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 5, 1);
    const userLimits = { dailyMicros: 30_000 };
    const person = await persons.resolve(bot, { phone: '+91 98000 00001' });
    await persons.link(bot, person!, { email: 'Asha@Example.test' });
    expect(await persons.find(bot, { email: 'asha@example.test' })).toBe(
      person,
    );

    const turn = (runId: string, sender: { phone?: string; email?: string }) =>
      limits.checkTurn({
        chatbotId: bot,
        creatorUserId: 1,
        conversationKey: runId,
        context: {
          runId,
          chatbotId: bot,
          channel: UsageChannel.WHATSAPP,
          runKind: UsageKind.CUSTOMER_REPLY,
        },
        sender,
        userLimits,
      });
    expect(await turn('p-1', { phone: '919800000001' })).toBeNull();
    await usage.record({
      runId: 'p-1',
      kind: UsageKind.CUSTOMER_REPLY,
      channel: UsageChannel.WHATSAPP,
      chatbotId: bot,
      fixedCostMicros: 20_000,
    } as never);
    // By email now: the same person, 20k spent of a 30k day, so a 20k reservation is refused.
    expect(await turn('p-2', { email: 'asha@example.test' })).toBe(
      'out_of_credits',
    );
    const rows = await dataSource.query(
      `SELECT DISTINCT end_person_id FROM end_person_spend`,
    );
    expect(rows).toEqual([{ end_person_id: person }]);
  });

  it('an identity already linked to someone else is never merged', async () => {
    const a = await persons.resolve(bot, { phone: '+919800000001' });
    const b = await persons.resolve(bot, { email: 'b@example.test' });
    await expect(
      persons.link(bot, a!, { email: 'b@example.test' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(a).not.toBe(b);
    expect(await persons.resolve(bot, { phone: '98000' })).toBeNull(); // under ten digits
  });

  it('the nightly rebuild sets every counter from its rows', async () => {
    await grant(1, 10);
    await ledger.setBudget(bot, 2, 1);
    await spend(300_000);
    await dataSource.query(
      `UPDATE billing_accounts SET granted_micros = 1, set_aside_micros = 0, builder_spent_micros = 99`,
    );
    await dataSource.query(`UPDATE chatbot_budgets SET spent_micros = 0`);
    await ledger.rebuild();
    expect(await free(1)).toBe(8 * USD);
    expect((await ledger.openBudget(bot))!.spent).toBe(300_000);
  });

  it('warns at 50, 80 and 95% once per threshold, and re-arms after a top-up', async () => {
    const warnings = new CreditWarningService(dataSource, ledger, {
      sendEmail: async (email: { to: string; subject: string }) => {
        emails.push(email);
        return true;
      },
    } as never);
    await grant(1, 10);
    await ledger.setBudget(bot, 1, 1);
    const budgetId = (await ledger.openBudget(bot))!.id;
    const check = () => warnings.check({ budgetId });

    await spend(550_000);
    expect(await check()).toBe(true);
    expect(await check()).toBe(false); // once
    await spend(50_000); // 60%
    expect(await check()).toBe(false);
    await spend(360_000); // 96%: straight to 95, one email
    expect(await check()).toBe(true);
    expect(emails.map((e) => e.subject)).toEqual([
      '"Test bot" has used 50% of its budget',
      '"Test bot" has used 95% of its budget',
    ]);
    await ledger.topUpBudget(bot, 1, 1); // 960k of 2M = 48%: nothing yet, but re-armed
    await spend(100_000); // 53% of the new epoch
    expect(await check()).toBe(true);
  });

  it('the cutover grant is a dry run first, and idempotent', async () => {
    const cutover = new CreditsCutoverService(dataSource, ledger);
    const dry = await cutover.run(true, 99);
    expect(dry.totals).toMatchObject({
      buildersGranted: 1,
      budgetsSet: 1,
      skipped: 0,
    });
    expect(await ledger.findAccount(1)).toBeNull();

    const applied = await cutover.run(false, 99);
    expect(applied.builders).toEqual([{ userId: 1, granted: 'new' }]);
    expect(await free(1)).toBe(18 * USD);
    expect((await ledger.openBudget(bot))!.setAside).toBe(2 * USD);

    const again = await cutover.run(false, 99);
    expect(again.builders).toEqual([{ userId: 1, granted: 'already' }]);
    expect(again.budgets[0].outcome).toBe('already');
    expect(await free(1)).toBe(18 * USD);
  });

  it('background work pauses at zero credits and resumes after a grant', async () => {
    const resumed: string[] = [];
    limits.onResume('site_reading', async (job) => {
      resumed.push(job.subjectId);
    });
    const gate = await limits.backgroundGate({
      kind: 'site_reading',
      subjectId: 'draft-1',
      creatorUserId: 1,
      chatbotId: bot,
      runKey: 'k',
      ownerRunKind: 'site_reading',
      payload: { pages: [] },
    });
    expect(gate).toMatchObject({
      ok: false,
      paused: true,
      reason: 'free_balance_empty',
    });
    expect(await ledger.pausedFor('draft-1')).toHaveLength(1);
    expect(await ledger.resumePaused()).toBe(0);
    await grant(1, 1);
    expect(await ledger.resumePaused()).toBe(1);
    expect(resumed).toEqual(['draft-1']);
    expect(await ledger.pausedFor('draft-1')).toHaveLength(0);
  });
});
