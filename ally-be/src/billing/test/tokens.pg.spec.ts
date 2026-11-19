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
import { TokenService } from '../service/token.service';
import { UsageEventService } from '../service/usage-event.service';
import { BILLING_ENTITIES } from './billing-entities';

/**
 * CR1 Part B: token allowances on real Postgres — assign, top up, update, revoke, delete (refused
 * once used), unlimited, renewal, and concurrent runs keeping the balance right.
 */
describePg('Billing: tokens (Postgres)', () => {
  let dataSource: DataSource;
  let usage: UsageEventService;
  let tokens: TokenService;
  let bot: string;
  const USER = 1; // seedChatbot's creator
  const fired: string[] = [];

  beforeAll(async () => {
    dataSource = await openTestDataSource(BILLING_ENTITIES);
    usage = new UsageEventService(dataSource);
    tokens = new TokenService(
      dataSource,
      new BillingAuditService(dataSource),
      usage,
      {
        fire: async (kind: string) => {
          fired.push(kind);
          return true;
        },
      } as never,
    );
    usage.addListener(tokens);
  });
  afterAll(() => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE usage_events, billing_audit, token_grants, token_balances`,
    );
    fired.length = 0;
    bot = await seedChatbot(dataSource);
  });

  let run = 0;
  const spend = (input: number, output = 0) =>
    usage.record({
      runId: `run-${++run}`,
      kind: UsageKind.CUSTOMER_REPLY,
      channel: UsageChannel.BOT_PAGE,
      chatbotId: bot,
      provider: 'openai',
      model: 'gpt-5-mini',
      inputTokens: input,
      outputTokens: output,
    });

  it('leaves users without an allowance alone', async () => {
    await spend(1000);
    expect(await tokens.state(USER)).toMatchObject({ hasAllowance: false });
    expect(await tokens.isUsedUp(USER)).toBe(false);
  });

  it('assigns, tops up and counts input + output tokens', async () => {
    await tokens.assign(USER, { amount: 10_000, note: 'Pilot' }, 9);
    await tokens.assign(USER, { amount: 5_000, note: 'Top up' }, 9);
    await spend(3_000, 1_000);
    const state = await tokens.state(USER);
    expect(state).toMatchObject({
      hasAllowance: true,
      left: 11_000,
      granted: 15_000,
      usedThisMonth: 4_000,
    });
  });

  it('a redelivered event is counted once', async () => {
    await tokens.assign(USER, { amount: 10_000, note: 'Pilot' }, 9);
    const call = {
      runId: 'same',
      kind: UsageKind.CUSTOMER_REPLY,
      channel: UsageChannel.WHATSAPP,
      chatbotId: bot,
      provider: 'openai',
      model: 'gpt-5-mini',
      inputTokens: 1_000,
    };
    await usage.record(call);
    await usage.record(call);
    expect((await tokens.state(USER)).left).toBe(9_000);
  });

  it('is used up at zero; a run already going dips below by at most that run, taken from the next grant', async () => {
    await tokens.assign(USER, { amount: 1_000, note: 'Small' }, 9);
    await spend(1_500);
    expect(await tokens.state(USER)).toMatchObject({
      left: -500,
      overdraft: 500,
    });
    expect(await tokens.isUsedUp(USER)).toBe(true);
    await tokens.assign(USER, { amount: 2_000, note: 'More' }, 9);
    expect(await tokens.state(USER)).toMatchObject({
      left: 1_500,
      overdraft: 0,
    });
    expect(await tokens.isUsedUp(USER)).toBe(false);
  });

  it('update moves the balance by the difference', async () => {
    const { grants } = await tokens.assign(
      USER,
      { amount: 10_000, note: 'Pilot' },
      9,
    );
    await spend(4_000);
    await tokens.update(USER, grants[0].id, { amount: 6_000, note: 'Less' }, 9);
    expect((await tokens.state(USER)).left).toBe(2_000);
    await tokens.update(
      USER,
      grants[0].id,
      { amount: 3_000, note: 'Even less' },
      9,
    );
    expect((await tokens.state(USER)).left).toBe(0);
  });

  it('revoke removes the unused part; used stays used; delete only while unused', async () => {
    const first = (await tokens.assign(USER, { amount: 10_000, note: 'A' }, 9))
      .grants[0];
    await spend(2_000);
    await expect(tokens.remove(USER, first.id, 'Mistake', 9)).rejects.toThrow(
      'Revoke it instead',
    );
    const after = await tokens.revoke(USER, first.id, 'Ended', 9);
    expect(after.grants[0]).toMatchObject({
      status: 'revoked',
      remaining: 0,
      used: 2_000,
    });
    expect(after.left).toBe(0);

    const mistake = (
      await tokens.assign(USER, { amount: 500, note: 'Typo' }, 9)
    ).grants[0];
    const removed = await tokens.remove(USER, mistake.id, 'Typo', 9);
    expect(removed.grants.map((g) => g.id)).not.toContain(mistake.id);
    expect(removed.history.map((h) => h.action)).toEqual([
      'delete',
      'assign',
      'revoke',
      'assign',
    ]);
    await expect(
      tokens.assign(USER, { amount: 5, note: '' }, 9),
    ).rejects.toThrow('note');
  });

  it('unlimited counts but never limits', async () => {
    await tokens.setUnlimited(USER, true, 'Ally team', 9);
    await spend(50_000);
    expect(await tokens.state(USER)).toMatchObject({
      unlimited: true,
      usedThisMonth: 50_000,
    });
    expect(await tokens.isUsedUp(USER)).toBe(false);
  });

  it('renews monthly on its own day, and expires', async () => {
    const { grants } = await tokens.assign(
      USER,
      { amount: 1_000, renewMonthly: true, note: 'Monthly' },
      9,
    );
    await spend(1_200);
    const due = new Date(grants[0].nextRenewalAt!);
    const result = await tokens.renewAndExpire(new Date(due.getTime() + 1000));
    expect(result.renewed).toBe(1);
    const state = await tokens.state(USER);
    expect(state.left).toBe(800); // refilled, less the 200 used past zero
    expect(new Date(state.resetsOn!).getTime()).toBeGreaterThan(due.getTime());

    await tokens.assign(
      USER,
      {
        amount: 5_000,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        note: 'Trial',
      },
      9,
    );
    expect(
      (await tokens.renewAndExpire(new Date(Date.now() + 120_000))).expired,
    ).toBe(1);
  });

  it('keeps the balance right under concurrent runs', async () => {
    await tokens.assign(USER, { amount: 100_000, note: 'Load' }, 9);
    await Promise.all(Array.from({ length: 25 }, () => spend(1_000, 200)));
    const state = await tokens.state(USER);
    expect(state.left).toBe(100_000 - 25 * 1_200);
    expect(state.usedThisMonth).toBe(25 * 1_200);
    expect(await tokens.reconcile()).toEqual([]);
  });
});
