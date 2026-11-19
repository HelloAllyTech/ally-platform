import {
  designCloseBlockers,
  NO_DESIGN_BLOCKER,
  planCloseReadiness,
} from '../plan-close-readiness.util';

const approved = {
  status: 'approved',
  ready: true,
  stale: false,
  blockers: [],
};

describe('planCloseReadiness (one definition of ready to close)', () => {
  it('is ready only with no PRD blocker, an approved current design and no conflicts', () => {
    expect(
      planCloseReadiness({
        planBlockers: [],
        requirementCount: 3,
        design: approved,
        openConflicts: 0,
      }),
    ).toEqual({ ready: true, prdEmpty: false, blockers: [] });
  });

  it('lists an empty PRD, a missing design and conflicts, in that order', () => {
    const out = planCloseReadiness({
      planBlockers: ['Write the problem.', 'Set a success measure.'],
      requirementCount: 0,
      design: null,
      openConflicts: 2,
    });
    expect(out.ready).toBe(false);
    expect(out.prdEmpty).toBe(true);
    expect(out.blockers.map((b) => b.kind)).toEqual([
      'prd',
      'prd',
      'design',
      'answers',
    ]);
    expect(out.blockers[2].text).toBe(NO_DESIGN_BLOCKER);
    expect(out.blockers[3].text).toMatch(/^2 agent questions/);
  });

  it('drops blank and repeated blockers', () => {
    const out = planCloseReadiness({
      planBlockers: ['A.', ' ', 'A.'],
      requirementCount: 1,
      design: approved,
      openConflicts: 0,
    });
    expect(out.blockers).toEqual([{ kind: 'prd', text: 'A.' }]);
  });
});

describe('designCloseBlockers', () => {
  it('asks for approval of a sound design in review', () => {
    expect(
      designCloseBlockers({
        status: 'review',
        ready: true,
        stale: false,
        blockers: [],
      }),
    ).toEqual(['Approve the technical design.']);
  });

  it('treats an approved design drafted from an older PRD as not approved', () => {
    expect(designCloseBlockers({ ...approved, stale: true })[0]).toMatch(
      /PRD changed/,
    );
  });

  it('lists at most three of the design’s own blockers', () => {
    const out = designCloseBlockers({
      status: 'review',
      ready: false,
      stale: false,
      blockers: ['a', 'b', 'c', 'd'],
    });
    expect(out).toEqual([
      'Technical design: a',
      'Technical design: b',
      'Technical design: c',
    ]);
  });

  it('waits on a design still drafting', () => {
    expect(
      designCloseBlockers({
        status: 'drafting',
        ready: false,
        stale: false,
        blockers: [],
      })[0],
    ).toMatch(/drafting/);
  });
});
