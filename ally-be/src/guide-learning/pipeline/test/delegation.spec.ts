import { GUIDE_DEFAULT_LOOP_POLICY } from 'src/guide/release/guide-release.bundle';
import { RED_TEAM_CATEGORY_IDS } from '../../evals/categories';
import {
  DelegationCounts,
  delegationPreconditions,
  highestUnlockedStage,
  stageChangeRefusal,
} from '../delegation';

const full = (): DelegationCounts => ({
  activeCases: 150,
  safetyCases: 60,
  minedCases: 40,
  casesByHardCategory: Object.fromEntries(
    RED_TEAM_CATEGORY_IDS.map((id) => [id, 8]),
  ),
  evaluatorDays: 28.2,
  kappa: {
    safety: { kappa: 0.61, trusted: true },
    grounding: { kappa: 0.6, trusted: true },
  },
  cleanCanaries: 3,
});

const pre = (counts: DelegationCounts) =>
  delegationPreconditions(
    counts,
    GUIDE_DEFAULT_LOOP_POLICY,
    0.6,
    RED_TEAM_CATEGORY_IDS,
  );

describe('progressive delegation preconditions (Appendix A)', () => {
  it('unlocks stage 3 exactly at the thresholds', () => {
    const list = pre(full());
    expect(list.every((p) => p.met)).toBe(true);
    expect(highestUnlockedStage(list)).toBe(3);
  });

  it('holds stage 2 back on any one shortfall', () => {
    const shortfalls: Array<[Partial<DelegationCounts>, string]> = [
      [{ activeCases: 149 }, 'cases'],
      [{ safetyCases: 59 }, 'safety_cases'],
      [{ minedCases: 39 }, 'mined_cases'],
      [
        {
          casesByHardCategory: {
            ...full().casesByHardCategory,
            [RED_TEAM_CATEGORY_IDS[0]]: 7,
          },
        },
        `category:${RED_TEAM_CATEGORY_IDS[0]}`,
      ],
      [{ evaluatorDays: 27.9 }, 'evaluator_days'],
      [{ evaluatorDays: null }, 'evaluator_days'],
      [
        { kappa: { ...full().kappa, safety: { kappa: 0.59, trusted: false } } },
        'kappa:safety',
      ],
      // A high κ on too few pairs is not trusted.
      [
        {
          kappa: { ...full().kappa, grounding: { kappa: 0.9, trusted: false } },
        },
        'kappa:grounding',
      ],
    ];
    for (const [over, id] of shortfalls) {
      const list = pre({ ...full(), ...over });
      expect(list.find((p) => p.id === id)!.met).toBe(false);
      expect(highestUnlockedStage(list)).toBe(1);
    }
  });

  it('needs 3 clean canaries a person approved for stage 3 only', () => {
    const list = pre({ ...full(), cleanCanaries: 2 });
    expect(list.find((p) => p.id === 'clean_canaries')).toMatchObject({
      stage: 3,
      met: false,
    });
    expect(highestUnlockedStage(list)).toBe(2);
  });

  it('a person raises one unlocked step at a time and lowers any time', () => {
    expect(stageChangeRefusal(1, 2, 3)).toBeNull();
    expect(stageChangeRefusal(1, 3, 3)).toMatch(/one step at a time/);
    expect(stageChangeRefusal(2, 3, 2)).toMatch(/locked/);
    expect(stageChangeRefusal(3, 1, 1)).toBeNull();
    expect(stageChangeRefusal(2, 1, 1)).toBeNull();
    expect(stageChangeRefusal(1, 4, 3)).toMatch(/1, 2 or 3/);
  });
});
