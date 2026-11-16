import { DebriefConsoleController } from '../controller/debrief-console.controller';

/**
 * Settings › Budgets (v9: a budget change needs a person's confirmation, the
 * owner's): budgets alone go live on the owner's confirm, still as a release
 * with its idea and audit so Roll back undoes them. The evaluator bar is not a
 * budget: it is proposed and climbs the ladder.
 */
describe('DebriefConsoleController.budgets', () => {
  function setup(budgetOnly: boolean) {
    const releaseHistory = {
      proposeChange: jest.fn(async () => ({
        ideaId: 'idea-1',
        releaseId: 'rel-8',
        version: 8,
        budgetOnly,
        diff: {},
      })),
    };
    const pmAgent = { approve: jest.fn(async () => ({ stage: 'promoted' })) };
    const ctl = {
      releaseHistory,
      pmAgent,
    } as unknown as DebriefConsoleController;
    const call = (body: Record<string, unknown>) =>
      DebriefConsoleController.prototype.budgets.call(
        ctl,
        { user: { id: 124 } } as any,
        body as any,
      );
    return { releaseHistory, pmAgent, call };
  }

  it('puts a budgets-only change live on the owner’s confirm', async () => {
    const { releaseHistory, pmAgent, call } = setup(true);
    const res = await call({ monthlyCapUsd: 150, note: 'raise the cap' });
    expect(releaseHistory.proposeChange).toHaveBeenCalledWith(
      {
        title: 'Monthly cap to $150',
        why: 'raise the cap',
        settings: { monthlyCapUsd: 150 },
      },
      124,
    );
    expect(pmAgent.approve).toHaveBeenCalledWith(
      'idea-1',
      124,
      'raise the cap',
    );
    expect(res).toMatchObject({ version: 8, live: true });
  });

  it('only proposes a change that is not budgets alone', async () => {
    const { pmAgent, call } = setup(false);
    const res = await call({ passScore: 8.5 });
    expect(pmAgent.approve).not.toHaveBeenCalled();
    expect(res).toMatchObject({ version: 8, live: false });
  });
});
