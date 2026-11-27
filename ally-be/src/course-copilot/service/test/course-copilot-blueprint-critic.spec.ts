import { CourseCopilotBlueprintService } from '../course-copilot-blueprint.service';
import {
  BlueprintCriticFinding,
  criticRepairList,
  normaliseCriticFindings,
} from '../specialists/blueprint-critic.specialist';
import { makeSession } from './course-copilot-test.fixtures';

const plan = (title: string) =>
  ({
    title,
    sections: [
      {
        id: 's1',
        title: 'Practice',
        items: [
          { id: 'i1', type: 'ARTICLE', title: 'Read', estimatedMinutes: 10 },
          {
            id: 'i2',
            type: 'ROLEPLAY',
            title: 'Practise',
            estimatedMinutes: 20,
          },
        ],
      },
    ],
  }) as any;

const blocking = (problem: string): BlueprintCriticFinding => ({
  severity: 'blocking',
  criterion: 'skill_targets',
  problem,
  fix: 'Add a practice on a new scenario.',
});
const advisory = (problem: string): BlueprintCriticFinding => ({
  severity: 'advisory',
  criterion: 'reflection',
  problem,
  fix: '',
});

describe('normaliseCriticFindings', () => {
  it('puts blocking findings first, keeps known item ids, drops invented ones', () => {
    const findings = normaliseCriticFindings(
      {
        findings: [
          {
            severity: 'advisory',
            criterion: 'fit',
            problem: 'Long article',
            itemId: 'i1',
          },
          {
            severity: 'BLOCKING',
            criterion: 'assessment',
            problem: 'No pass rule',
            itemId: 'i9',
          },
          {
            severity: 'blocking',
            criterion: 'nonsense',
            problem: 'Bad order',
            fix: 'Swap them',
          },
          { severity: 'blocking', problem: '' },
        ],
      },
      plan('P'),
    );
    expect(findings.map((f) => f.severity)).toEqual([
      'blocking',
      'blocking',
      'advisory',
    ]);
    expect(findings[0]).toMatchObject({
      criterion: 'assessment',
      problem: 'No pass rule',
    });
    expect(findings[0].itemId).toBeUndefined();
    expect(findings[1].criterion).toBe('fit');
    expect(findings[2].itemId).toBe('i1');
  });

  it('caps the findings at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      severity: 'advisory',
      problem: `p${i}`,
    }));
    expect(normaliseCriticFindings({ findings: many }, plan('P'))).toHaveLength(
      8,
    );
  });

  it('turns blocking findings into the planner repair list', () => {
    const list = criticRepairList([
      { ...blocking('B2 never practised on a new scenario'), itemId: 'i2' },
      advisory('No debrief'),
    ]);
    expect(list).toEqual([
      'Critic (skill_targets) on item i2: B2 never practised on a new scenario Change: Add a practice on a new scenario.',
    ]);
  });
});

describe('CourseCopilotBlueprintService — critic', () => {
  let query: jest.Mock;
  let planner: { repair: jest.Mock };
  let critic: { critique: jest.Mock };

  const build = (enabled = true) =>
    new CourseCopilotBlueprintService(
      { courseCopilot: { critic: enabled } } as any,
      { manager: { query } } as any,
      planner as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      critic as any,
    );
  const check = (service: CourseCopilotBlueprintService, planned: any) =>
    (service as any).checkWithCritic(
      makeSession({ id: 'sess-1', brief: {} }),
      { sessionId: 'sess-1', brief: {} },
      planned,
      null,
    );

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    planner = { repair: jest.fn() };
    critic = { critique: jest.fn() };
  });

  it('does nothing when switched off', async () => {
    const first = plan('first');
    const result = await check(build(false), first);
    expect(result).toEqual({ blueprint: first, report: null });
    expect(critic.critique).not.toHaveBeenCalled();
  });

  it('keeps a clean plan and records the check', async () => {
    critic.critique.mockResolvedValue([advisory('No debrief')]);
    const first = plan('first');
    const result = await check(build(), first);
    expect(result.blueprint).toBe(first);
    expect(result.report).toMatchObject({
      repaired: false,
      remaining: [advisory('No debrief')],
    });
    expect(planner.repair).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'coursePilot'"),
      ['sess-1', 'critic', expect.any(String)],
    );
  });

  it('repairs once on blocking findings and keeps the better plan', async () => {
    const first = plan('first');
    const second = plan('second');
    critic.critique
      .mockResolvedValueOnce([
        blocking('B2 not practised'),
        blocking('No pass rule'),
      ])
      .mockResolvedValueOnce([advisory('No debrief')]);
    planner.repair.mockResolvedValue(second);
    const result = await check(build(), first);
    expect(planner.repair).toHaveBeenCalledTimes(1);
    expect(planner.repair.mock.calls[0][1]).toHaveLength(2);
    expect(result.blueprint).toBe(second);
    expect(result.report).toMatchObject({
      repaired: true,
      remaining: [advisory('No debrief')],
    });
  });

  it('keeps the first plan when the repair is worse', async () => {
    const first = plan('first');
    critic.critique
      .mockResolvedValueOnce([blocking('B2 not practised')])
      .mockResolvedValueOnce([blocking('a'), blocking('b')]);
    planner.repair.mockResolvedValue(plan('second'));
    const result = await check(build(), first);
    expect(result.blueprint).toBe(first);
    expect(result.report.repaired).toBe(false);
  });

  it('keeps the first plan when the repair returns nothing', async () => {
    const first = plan('first');
    critic.critique.mockResolvedValueOnce([blocking('B2 not practised')]);
    planner.repair.mockResolvedValue(null);
    const result = await check(build(), first);
    expect(result.blueprint).toBe(first);
    expect(critic.critique).toHaveBeenCalledTimes(1);
  });

  it('never blocks the plan when the critic fails', async () => {
    const first = plan('first');
    critic.critique.mockRejectedValue(new Error('model down'));
    const result = await check(build(), first);
    expect(result).toEqual({ blueprint: first, report: null });
  });
});
