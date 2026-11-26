import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import { PlanSession } from '../plan-session.store';
import { PlanStageService } from '../plan-stage.service';

/**
 * Only the build fact: a design run is drafted from PRD_READY and never moves
 * the session, so it must not read as "a build has started". It used to,
 * through `lastRunSequence`, which numbers every run (OPP-0938, 2026-11-26).
 */
describe('PlanStageService.facts → buildStarted', () => {
  const build = (runRows: unknown[]) => {
    const query = jest.fn().mockResolvedValue(runRows);
    const opportunities = {
      findOne: jest.fn().mockResolvedValue(null),
      manager: { query },
    };
    const service = new PlanStageService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      opportunities as never,
    );
    return { service, query };
  };

  // Private, so facts() skips the PRD and design assessment this is not about.
  const plan = (over: Partial<PlanSession> = {}): PlanSession =>
    ({
      id: 's1',
      status: 'PRD_READY',
      visibility: BuilderSessionVisibility.PRIVATE,
      leadUserId: null,
      lastRunSequence: 2,
      plan: {},
      ...over,
    }) as unknown as PlanSession;

  it('is false when every run is a design run', async () => {
    const { service, query } = build([]);
    const facts = await service.facts(plan());
    expect(facts.buildStarted).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining(`<> 'design'`), [
      's1',
    ]);
  });

  it('is true once a build run exists', async () => {
    const { service } = build([{ '?column?': 1 }]);
    expect((await service.facts(plan())).buildStarted).toBe(true);
  });

  it('is true on a build status even with no build run row', async () => {
    const { service } = build([]);
    expect(
      (await service.facts(plan({ status: 'FAILED' } as never))).buildStarted,
    ).toBe(true);
  });

  it('does not query when the session has run nothing', async () => {
    const { service, query } = build([]);
    const facts = await service.facts(plan({ lastRunSequence: 0 } as never));
    expect(facts.buildStarted).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
