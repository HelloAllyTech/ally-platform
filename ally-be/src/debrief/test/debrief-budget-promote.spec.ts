import { ConflictException } from '@nestjs/common';
import {
  DEBRIEF_ORCHESTRATOR_PROMPT_CODES,
  DEBRIEF_SEED_BUNDLE,
} from '../constants/debrief-release.constants';
import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';

/**
 * A budgets-only change goes live on the owner's word, but only while its
 * draft still differs from the live release in budgets alone: a draft made
 * before a deploy or a promotion would otherwise undo them (found 2026-11-16:
 * a cap change drafted before the orchestrator went on would turn it off).
 */
describe('putting a budgets-only change live', () => {
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const live = clone(DEBRIEF_SEED_BUNDLE);

  function setup(draftBundle: unknown) {
    const makeGa = jest.fn(async () => ({ version: 13 }));
    const ctx: any = {
      releases: {
        getById: jest.fn(async () => ({ id: 'rel-d', bundle: draftBundle })),
        makeGa,
      },
      gaBundle: async () => ({ id: 'rel-live', bundle: live }),
      dataSource: { query: jest.fn(async () => []) },
      audit: jest.fn(async () => undefined),
      notifier: { owner: jest.fn(async () => 0) },
    };
    const promote = (DebriefPmAgentService.prototype as any)
      .promoteBudgetChange;
    const idea = {
      id: 'idea-1',
      text: 'Settings: monthlyCapUsd',
      change: { ideaKind: 'release', releaseId: 'rel-d', budgetOnly: true },
    };
    return { run: () => promote.call(ctx, idea, 124, 'raise the cap'), makeGa };
  }

  it('goes live when the draft differs from the live release in budgets alone', async () => {
    const draft = clone(live);
    draft.settings.monthlyCapUsd = 150;
    const { run, makeGa } = setup(draft);
    await expect(run()).resolves.toMatchObject({
      version: 13,
      stage: 'promoted',
    });
    expect(makeGa).toHaveBeenCalled();
  });

  it('is refused when the live release moved since: it would undo the orchestrator', async () => {
    const before = clone(live);
    delete (before as any).orchestrator;
    for (const c of DEBRIEF_ORCHESTRATOR_PROMPT_CODES) delete before.prompts[c];
    before.settings.monthlyCapUsd = 150;
    const { run, makeGa } = setup(before);
    await expect(run()).rejects.toBeInstanceOf(ConflictException);
    expect(makeGa).not.toHaveBeenCalled();
  });
});
