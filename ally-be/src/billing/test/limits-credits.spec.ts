import { HttpException } from '@nestjs/common';
import { UsageChannel, UsageKind } from '../enum/billing.enum';
import { LimitsService } from '../service/limits.service';
import { usageHeaders, usageContext } from '../context/usage-context';

/**
 * The stage 6 credits gate in LimitsService, without a database: the kill switch, fail-closed
 * with a short grace when the ledger can't be read, the payer stamped on the run, and owner work
 * refused at a zero free balance with `credits_required`.
 */
describe('LimitsService: credits gate (stage 6)', () => {
  const context = () => ({
    runId: 'wamid.abc',
    chatbotId: 'bot-1',
    channel: UsageChannel.WHATSAPP,
    runKind: UsageKind.CUSTOMER_REPLY,
  });
  const make = (ledger: Record<string, jest.Mock>) =>
    new LimitsService(
      {} as never,
      {} as never,
      {} as never,
      undefined,
      ledger as never,
      {
        find: jest.fn().mockResolvedValue(null),
        resolve: jest.fn(),
      } as never,
    );
  const okLedger = () => ({
    switches: jest
      .fn()
      .mockResolvedValue({ enforcement: true, warningEmails: true }),
    feedHealthy: jest.fn().mockResolvedValue(true),
    feedBlocksSpend: jest.fn().mockResolvedValue(false),
    builderPayer: jest.fn().mockResolvedValue('acct-1'),
    pauseJob: jest.fn().mockResolvedValue(undefined),
    reserve: jest.fn().mockResolvedValue({
      ok: true,
      accountId: 'acct-1',
      reservationId: 'r',
      reused: false,
    }),
    accountFor: jest.fn().mockResolvedValue('acct-1'),
    freeBalanceOf: jest.fn().mockResolvedValue(0),
  });

  it('stamps the payer on the run, and ally-ai is told it', async () => {
    const ledger = okLedger();
    const ctx = context();
    expect(
      await make(ledger).checkTurn({
        chatbotId: 'bot-1',
        creatorUserId: 1,
        conversationKey: 'c',
        context: ctx,
      }),
    ).toBeNull();
    expect(ctx).toMatchObject({ payerAccountId: 'acct-1' });
    const header = usageContext.run(ctx, () =>
      usageHeaders('api/v1/agent/run'),
    );
    expect(JSON.parse(header['X-Ally-Usage'])).toMatchObject({
      payer_account_id: 'acct-1',
    });
  });

  it('a refused reservation blocks the turn (OUT_OF_CREDITS)', async () => {
    const ledger = okLedger();
    ledger.reserve.mockResolvedValue({
      ok: false,
      reason: 'budget_empty',
      accountId: 'acct-1',
    });
    expect(
      await make(ledger).checkTurn({
        chatbotId: 'bot-1',
        creatorUserId: 1,
        conversationKey: 'c',
        context: context(),
      }),
    ).toBe('out_of_credits');
  });

  it('fails closed when the ledger cannot be read, after a short grace', async () => {
    const ledger = okLedger();
    const limits = make(ledger);
    const input = {
      chatbotId: 'bot-1',
      creatorUserId: 1,
      conversationKey: 'c',
      context: context(),
    };
    // Never passed: closed at once.
    ledger.feedBlocksSpend.mockRejectedValueOnce(new Error('db down'));
    expect(await limits.checkTurn(input)).toBe('out_of_credits');
    // Passed a moment ago: answered within the grace.
    expect(await limits.checkTurn({ ...input, context: context() })).toBeNull();
    ledger.feedBlocksSpend.mockRejectedValueOnce(new Error('db down'));
    expect(await limits.checkTurn({ ...input, context: context() })).toBeNull();
    // Grace over: closed.
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    ledger.feedBlocksSpend.mockRejectedValueOnce(new Error('db down'));
    expect(await limits.checkTurn({ ...input, context: context() })).toBe(
      'out_of_credits',
    );
    jest.restoreAllMocks();
  });

  it('the owner testing at $0 is owner_credits; owner work is refused with credits_required', async () => {
    const ledger = okLedger();
    ledger.reserve.mockResolvedValue({
      ok: false,
      reason: 'free_balance_empty',
      accountId: 'acct-1',
    });
    const limits = make(ledger);
    expect(
      await limits.checkTurn({
        chatbotId: 'bot-1',
        creatorUserId: 1,
        conversationKey: 'c',
        context: {
          ...context(),
          channel: UsageChannel.OWNER,
          runKind: UsageKind.TRY_IT,
        },
      }),
    ).toBe('owner_credits');
    await expect(
      limits.assertOwnerRun(1, 'setup:x', 'setup'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'credits_required' }),
    });
    await expect(
      limits.assertOwnerRun(1, 'setup:x', 'setup'),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('with enforcement switched off, the CR1 checks run instead', async () => {
    const ledger = okLedger();
    ledger.switches.mockResolvedValue({
      enforcement: false,
      warningEmails: true,
    });
    const limits = make(ledger);
    const legacy = jest
      .spyOn(limits, 'legacyCheckTurn')
      .mockResolvedValue(null);
    await limits.checkTurn({
      chatbotId: 'bot-1',
      creatorUserId: 1,
      conversationKey: 'c',
      context: context(),
    });
    expect(legacy).toHaveBeenCalled();
    expect(ledger.reserve).not.toHaveBeenCalled();
  });

  describe('a stopped usage feed (feed_off)', () => {
    const ownerContext = () => ({
      ...context(),
      channel: UsageChannel.OWNER,
      runKind: UsageKind.TRY_IT,
    });

    it('blocks a turn with its real reason stamped, never as out of credits', async () => {
      const ledger = okLedger();
      ledger.feedBlocksSpend.mockResolvedValue(true);
      const ctx = ownerContext();
      expect(
        await make(ledger).checkTurn({
          chatbotId: 'bot-1',
          creatorUserId: 1,
          conversationKey: 'c',
          context: ctx,
        }),
      ).toBe('owner_credits');
      expect(ctx).toMatchObject({ creditBlockReason: 'feed_off' });
      expect(ledger.reserve).not.toHaveBeenCalled();
    });

    it("owner work is refused with the feed message, not 'contact Ally for credits'", async () => {
      const ledger = okLedger();
      ledger.freeBalanceOf.mockResolvedValue(20_000_000);
      ledger.feedBlocksSpend.mockResolvedValue(true);
      const error = await make(ledger)
        .assertOwnerRun(1, 'setup:x', 'setup')
        .catch((e: HttpException) => e);
      const body = (error as HttpException).getResponse() as Record<
        string,
        string
      >;
      expect(body.reason).toBe('feed_off');
      expect(body.message).toMatch(
        /usage tracking is temporarily unavailable/i,
      );
      expect(body.message).not.toMatch(/contact ally|credits to your account/i);
    });

    it('background indexing pauses with reason feed_off', async () => {
      const ledger = okLedger();
      ledger.freeBalanceOf.mockResolvedValue(20_000_000);
      ledger.feedBlocksSpend.mockResolvedValue(true);
      const gate = await make(ledger).backgroundGate({
        kind: 'indexing',
        subjectId: 'doc-1',
        creatorUserId: 2,
        chatbotId: 'bot-1',
        runKey: 'k',
        ownerRunKind: 'indexing',
        payload: { documentId: 'doc-1' },
      });
      expect(gate).toEqual({ ok: false, paused: true, reason: 'feed_off' });
      expect(ledger.pauseJob).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'feed_off' }),
      );
    });

    it('a no-payer pause says so', async () => {
      const ledger = okLedger();
      ledger.builderPayer.mockResolvedValue(null);
      const gate = await make(ledger).backgroundGate({
        kind: 'indexing',
        subjectId: 'doc-1',
        creatorUserId: null,
        chatbotId: 'bot-1',
        runKey: 'k',
        ownerRunKind: 'indexing',
        payload: {},
      });
      expect(gate).toMatchObject({ paused: true, reason: 'no_payer' });
    });

    it('not blocking (local): the run goes ahead, its cost marked unrecorded', async () => {
      const ledger = okLedger();
      ledger.feedHealthy.mockResolvedValue(false);
      ledger.feedBlocksSpend.mockResolvedValue(false);
      const ctx = context();
      expect(
        await make(ledger).checkTurn({
          chatbotId: 'bot-1',
          creatorUserId: 1,
          conversationKey: 'c',
          context: ctx,
        }),
      ).toBeNull();
      expect(ctx).toMatchObject({
        payerAccountId: 'acct-1',
        costUnrecorded: true,
      });
    });
  });
});
