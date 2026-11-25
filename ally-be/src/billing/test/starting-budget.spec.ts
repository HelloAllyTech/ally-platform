import { LedgerService } from '../service/ledger.service';

/** TF1 S2: going live with no budget left the assistant answering nobody. */
describe('LedgerService.ensureStartingBudget', () => {
  const ledger = (over: {
    enforcement?: boolean;
    budget?: { setAside: number } | null;
    payer?: string | null;
    free?: number;
  }) => {
    const l = Object.create(LedgerService.prototype) as LedgerService;
    const setBudget = jest.fn(async (_id: string, usd: number) => ({
      setAsideMicros: Math.round(usd * 1e6),
      clamped: false,
      warning: null,
    }));
    Object.assign(l, {
      switches: async () => ({
        enforcement: over.enforcement ?? true,
        warningEmails: false,
      }),
      openBudget: async () => (over.budget === undefined ? null : over.budget),
      builderPayer: async () =>
        over.payer === undefined ? 'acct-1' : over.payer,
      freeBalanceOf: async () => over.free ?? 20_000_000,
      setBudget,
    });
    return { l, setBudget };
  };

  it('sets aside the $2 starting budget from the free balance', async () => {
    const { l, setBudget } = ledger({});
    await expect(l.ensureStartingBudget('bot-1', 1)).resolves.toEqual({
      setAsideUsd: 2,
      added: true,
    });
    expect(setBudget).toHaveBeenCalledWith('bot-1', 2, 1);
  });

  it('takes what is free when that is less', async () => {
    const { l, setBudget } = ledger({ free: 500_000 });
    await expect(l.ensureStartingBudget('bot-1', 1)).resolves.toEqual({
      setAsideUsd: 0.5,
      added: true,
    });
    expect(setBudget).toHaveBeenCalledWith('bot-1', 0.5, 1);
  });

  it('never touches a budget the owner set, even $0', async () => {
    const { l, setBudget } = ledger({ budget: { setAside: 0 } });
    await expect(l.ensureStartingBudget('bot-1', 1)).resolves.toEqual({
      setAsideUsd: 0,
      added: false,
    });
    expect(setBudget).not.toHaveBeenCalled();
  });

  it('says nothing was set aside when the free balance is empty', async () => {
    const { l, setBudget } = ledger({ free: 0 });
    await expect(l.ensureStartingBudget('bot-1', 1)).resolves.toEqual({
      setAsideUsd: 0,
      added: false,
    });
    expect(setBudget).not.toHaveBeenCalled();
  });

  it('does nothing with credits off', async () => {
    const { l, setBudget } = ledger({ enforcement: false });
    await expect(l.ensureStartingBudget('bot-1', 1)).resolves.toBeNull();
    expect(setBudget).not.toHaveBeenCalled();
  });
});
