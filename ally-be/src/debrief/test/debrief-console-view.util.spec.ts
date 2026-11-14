import { debriefRoles } from '../util/debrief-console-roles.util';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  approvalState,
  AutonomyFacts,
  effectivePolicy,
  heldReasons,
  kindEligibility,
  stepEligibility,
  matrixChangeRefusal,
  normaliseAutonomy,
  parseSessionFilters,
  pendingActions,
  PendingFacts,
  relockReason,
  turnsIn,
} from '../util/debrief-console-view.util';

const eligible: AutonomyFacts = {
  gate: { met: true, failing: [] },
  reverts: {},
  failedBaseline: { failed: false, detail: null },
  judgeDrift: null,
};
const ineligible: AutonomyFacts = {
  ...eligible,
  gate: { met: false, failing: [{ measure: 'accuracy', kappa: 0.52 }] },
};

describe('session list filters', () => {
  it('keeps known values and drops the rest', () => {
    expect(
      parseSessionFilters({
        category: 'flagged',
        fallback: 'heavy',
        cost: 'hit_ceiling',
        riskCue: 'true',
        language: 'hi',
        limit: '999',
      }),
    ).toEqual({
      category: 'flagged',
      fallback: 'heavy',
      cost: 'hit_ceiling',
      riskCue: true,
      language: 'hi',
      mode: 'production',
      limit: 200,
      offset: 0,
    });
    expect(
      parseSessionFilters({ category: 'nope', cost: 'cheap' }),
    ).toMatchObject({
      category: 'needs',
    });
    expect(parseSessionFilters({ cost: 'cheap' }).cost).toBeUndefined();
  });
});

describe('approvals expire after 14 days as "no decision"', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  it('counts from when it started waiting on a person', () => {
    const a = approvalState(
      {
        status: 'proposed',
        createdAt: '2026-11-01T00:00:00Z',
        change: { ideaKind: 'needs_code' },
        evidence: {
          handoff: { status: 'waiting', at: '2026-11-08T00:00:00Z' },
        },
      },
      now,
    )!;
    expect(a.wait).toBe('handoff');
    expect(a.expiresInDays).toBe(2);
    expect(a.expiringSoon).toBe(true);
    expect(a.expired).toBe(false);
  });
  it('expires, and nothing waits once expired or decided', () => {
    const idea = {
      status: 'proposed',
      createdAt: '2026-11-01T00:00:00Z',
      change: { ideaKind: 'pinned_rule' },
      evidence: {},
    };
    expect(approvalState(idea, now)!.expired).toBe(true);
    expect(
      approvalState({ ...idea, evidence: { expiry: {} } }, now),
    ).toBeNull();
    expect(approvalState({ ...idea, status: 'rejected' }, now)).toBeNull();
  });
  it('a passed canary waits for a promotion', () => {
    expect(
      approvalState(
        {
          status: 'proposed',
          createdAt: '2026-11-01T00:00:00Z',
          change: { ideaKind: 'setting' },
          evidence: {
            canary: { status: 'passed', checkedAt: '2026-11-19T00:00:00Z' },
          },
        },
        now,
      )!.wait,
    ).toBe('promote');
  });
});

describe('PM agent autonomy policy', () => {
  it('only the learner try-out can be set; "auto" there needs an eligible kind; pinned rules never', () => {
    // Plan §4: the κ gate is the canary's alone; learners never see the tests.
    expect(
      matrixChangeRefusal('prompts', 'canary', 'auto', ineligible),
    ).toMatch(/cannot run learner try-outs on its own.*0\.52/);
    // Quick check, pass test and side-by-side trial always run on their own:
    // not settings any more (2026-11-12).
    for (const step of ['quick_test', 'gate_test', 'paired_trial']) {
      for (const value of ['auto', 'ask', 'off']) {
        expect(matrixChangeRefusal('prompts', step, value, eligible)).toMatch(
          /always runs on its own/,
        );
      }
      expect(
        matrixChangeRefusal('pinned_rules', step, 'auto', eligible),
      ).toMatch(/pinned rules/);
    }
    expect(
      matrixChangeRefusal('prompts', 'canary', 'ask', ineligible),
    ).toBeNull();
    expect(
      matrixChangeRefusal('prompts', 'canary', 'auto', eligible),
    ).toBeNull();
    // A re-lock (2 reverts) blocks the try-out, even with an override.
    expect(
      matrixChangeRefusal(
        'prompts',
        'canary',
        'auto',
        { ...eligible, reverts: { prompts: 2 } },
        true,
      ),
    ).toMatch(/Not now/);
    expect(
      matrixChangeRefusal('pinned_rules', 'canary', 'ask', eligible),
    ).toMatch(/pinned rules/);
    expect(matrixChangeRefusal('prompts', 'promote', 'auto', eligible)).toMatch(
      /always a person/,
    );
    expect(kindEligibility('pinned_rules', eligible).eligible).toBe(false);
    expect(
      kindEligibility('pinned_rules', eligible, 'quick_test').eligible,
    ).toBe(false);
    expect(kindEligibility('prompts', ineligible).eligible).toBe(false);
    expect(
      kindEligibility(
        'prompts',
        { ...ineligible, reverts: { prompts: 2 } },
        'gate_test',
      ),
    ).toMatchObject({
      eligible: true,
      reason: expect.stringMatching(/learners never see it/),
    });
    expect(stepEligibility('settings', ineligible)).toMatchObject({
      quick_test: { eligible: true },
      gate_test: { eligible: true },
      paired_trial: { eligible: true },
      canary: { eligible: false, reason: expect.stringMatching(/0\.6/) },
    });
  });

  it('reasons name the gate measures in words, never a code', () => {
    const f = {
      ...ineligible,
      gate: {
        met: false,
        failing: [
          { measure: 'accuracy', kappa: null },
          { measure: 'evidence_specificity', kappa: 0.41 },
          { measure: 'missed_risk_cue', kappa: null },
          { measure: 'some_new_measure', kappa: null },
        ],
      },
    };
    for (const kind of ['settings', 'prompts', 'pinned_rules'] as const) {
      for (const e of Object.values(stepEligibility(kind, f))) {
        expect(e.reason).not.toMatch(/[a-z]+_[a-z]+/);
      }
    }
    expect(kindEligibility('prompts', f).reason).toBe(
      'Not yet: agreement below 0.6 (Accuracy not measured; Evidence 0.41; Missed risk cue not measured; Some new measure not measured).',
    );
  });

  it('an organisation only tightens: the stricter of global and org wins', () => {
    const policy = normaliseAutonomy({
      orgs: {
        org1: { canary: 'never', paired_trial: 'never' },
        // An attempt to loosen is dropped: "auto" is not an org value.
        org2: { canary: 'auto' as any },
        // The old side-by-side "asks first" reads as allowed.
        org3: { paired_trial: 'ask', canary: 'ask' },
      },
    });
    policy.matrix.settings.canary = 'auto';
    expect(effectivePolicy(policy, true, 'settings', 'canary', null)).toBe(
      'auto',
    );
    expect(effectivePolicy(policy, true, 'settings', 'canary', 'org1')).toBe(
      'off',
    );
    expect(
      effectivePolicy(policy, true, 'settings', 'paired_trial', 'org1'),
    ).toBe('off');
    expect(effectivePolicy(policy, true, 'settings', 'canary', 'org2')).toBe(
      'auto',
    );
    expect(policy.orgs.org3).toEqual({ canary: 'ask' });
    expect(
      effectivePolicy(policy, true, 'settings', 'paired_trial', 'org3'),
    ).toBe('auto');
    expect(effectivePolicy(policy, true, 'settings', 'canary', 'org3')).toBe(
      'ask',
    );
    // The master switch.
    expect(effectivePolicy(policy, false, 'settings', 'quick_test', null)).toBe(
      'off',
    );
  });

  it('the steps learners never see always run on their own, whatever was stored', () => {
    expect(normaliseAutonomy(null).matrix.prompts).toEqual({
      quick_test: 'auto',
      gate_test: 'auto',
      paired_trial: 'auto',
      canary: 'ask',
    });
    // An older policy (the quick-test switch off, a step set to ask) reads as auto.
    const old = normaliseAutonomy({
      matrix: {
        settings: {
          quick_test: 'ask',
          gate_test: 'off',
          paired_trial: 'ask',
          canary: 'auto',
        },
      } as any,
    });
    expect(old.matrix.settings).toEqual({
      quick_test: 'auto',
      gate_test: 'auto',
      paired_trial: 'auto',
      canary: 'auto',
    });
    expect(normaliseAutonomy(null).matrix.pinned_rules.quick_test).toBe('off');
  });

  it('re-locks on 2 reverts in 4 weeks, a failed baseline or judge drift, not on κ alone', () => {
    expect(
      relockReason('prompts', { ...eligible, reverts: { prompts: 2 } }),
    ).toMatch(/2 learner try-outs were taken back/);
    expect(
      relockReason('settings', { ...eligible, reverts: { prompts: 2 } }),
    ).toBeNull();
    expect(
      relockReason('prompts', {
        ...eligible,
        failedBaseline: { failed: true, detail: 'median 7.1, was 8.0' },
      }),
    ).toMatch(/baseline failed/);
    expect(relockReason('prompts', { ...eligible, judgeDrift: true })).toMatch(
      /drifted/,
    );
    expect(relockReason('prompts', ineligible)).toBeNull();
  });
});

describe('the "waiting on you" bar', () => {
  const base: PendingFacts = {
    runMode: 'live',
    status: 'published',
    reviewed: false,
    createdAt: '2026-11-12T08:00:00Z',
    learnerDistress: false,
    judgeBelowBar: false,
    riskCueTurns: [5],
    heldReasonTurns: [5],
    escalation: null,
    slaHours: 24,
    flags: [],
  };
  const team = { roles: debriefRoles([PERMISSIONS.SYSTEM_ACCESS]) };
  const advisor = { roles: debriefRoles([PERMISSIONS.REVIEW_DEBRIEFS], true) };
  const reader = { roles: debriefRoles([]) };
  const now = new Date('2026-11-12T09:00:00Z');

  it('learner distress in the session: Read first goes to the distress turns (Notes #21)', () => {
    const [a] = pendingActions(
      {
        ...base,
        riskCueTurns: [],
        learnerDistress: true,
        distressTurns: [8, 6],
      },
      team,
      now,
    );
    expect(a).toMatchObject({
      kind: 'learner_distress',
      level: 'red',
      anchors: { turns: [6, 8] },
    });
  });

  it('an urgent flag for the Ally team, with anchors; nothing for a reader', () => {
    const f: PendingFacts = {
      ...base,
      flags: [
        {
          id: 'f1',
          section: 'important_moment',
          status: 'open',
          urgent: true,
          reason: 'advice_doesnt_fit',
          note: 'She never said that',
          since: '2026-11-12T08:30:00Z',
          inUndoWindow: false,
          cardTurns: [6],
        },
      ],
    };
    const [a] = pendingActions(f, team, now);
    expect(a).toMatchObject({
      kind: 'urgent_flag',
      level: 'red',
      flagId: 'f1',
      overdue: false,
      waitingSince: '2026-11-12T08:30:00Z',
      anchors: {
        turns: [6],
        cardSection: 'important_moment',
        learnerNote: 'She never said that',
      },
      decisions: ['correct', 'keep', 'remove', 'escalate'],
    });
    expect(pendingActions(f, reader, now)).toEqual([]);
    // Inside the learner's undo window it is not work yet.
    expect(
      pendingActions(
        { ...f, flags: [{ ...f.flags[0], inUndoWindow: true }] },
        team,
        now,
      ),
    ).toEqual([]);
  });

  it('a held debrief turns red once past flagReviewSlaHours', () => {
    const f = { ...base, status: 'needs_person' };
    expect(pendingActions(f, team, now)[0]).toMatchObject({
      kind: 'held',
      level: 'yellow',
      overdue: false,
    });
    const late = pendingActions(f, team, new Date('2026-11-13T09:00:00Z'))[0];
    expect(late).toMatchObject({ kind: 'held', level: 'red', overdue: true });
    expect(late.decisions).toEqual(['publish', 'todays_debrief', 'escalate']);
  });

  it('escalations go to the clinical advisor, not the Ally team', () => {
    const f: PendingFacts = {
      ...base,
      escalation: {
        at: '2026-11-12T08:10:00Z',
        note: 'Is this right?',
        by: 'Priya',
      },
      flags: [
        {
          id: 'f2',
          section: 'work_on_this[0]',
          status: 'escalated',
          urgent: true,
          reason: 'advice_doesnt_fit',
          note: null,
          since: '2026-11-12T08:00:00Z',
          inUndoWindow: false,
          cardTurns: [5],
        },
      ],
    };
    const mine = pendingActions(f, advisor, now);
    expect(mine.map((a) => a.kind)).toEqual([
      'escalated_flag',
      'escalated_run',
    ]);
    expect(mine[0].decisions).toEqual(['correct', 'keep', 'remove']);
    expect(pendingActions(f, team, now).map((a) => a.kind)).toEqual([
      'urgent_flag',
    ]);
  });
});

describe('why the judge held it', () => {
  it('reads turn numbers out of the findings', () => {
    expect(
      turnsIn('the client raised hopelessness (turn 5); see turns 7-8'),
    ).toEqual([5, 7, 8]);
    const r = heldReasons({
      workspace: {
        judge: {
          hardFails: [
            { code: 'missed_risk_cue', evidence: 'turn 5 hopelessness' },
          ],
        },
      },
      checkFailures: [
        {
          code: 'C-9',
          section: 'progress_note',
          detail: 'claims progress without history',
        },
      ],
      evaluatorHardFails: [],
    });
    expect(r).toEqual([
      {
        source: 'judge',
        code: 'missed_risk_cue',
        text: 'turn 5 hopelessness',
        turns: [5],
      },
      {
        source: 'check',
        code: 'C-9',
        text: 'claims progress without history',
        turns: [],
      },
    ]);
  });
});
