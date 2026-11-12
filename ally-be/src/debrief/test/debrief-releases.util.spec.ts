import {
  DEBRIEF_SEED_BUNDLE,
  DebriefBundle,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import {
  applyStepEdits,
  bundleDiff,
  changedExcerpt,
  displayStatus,
  ladderOf,
  promptLabel,
} from '../util/debrief-releases.util';
import { approvalState, ideaState } from '../util/debrief-console-view.util';

const seed = (): DebriefBundle =>
  JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));

describe('release diff', () => {
  it('a change only to the judge’s prompt is not learner-visible (it skips the canary, spec §4)', () => {
    const before = seed();
    before.prompts = { ...before.prompts, debrief_quality_judge_system: 3 };
    const next = JSON.parse(JSON.stringify(before)) as DebriefBundle;
    next.prompts.debrief_quality_judge_system = 4;
    expect(bundleDiff(before, next).learnerVisible).toBe(false);
    next.prompts.debrief_writer_system = 9;
    expect(bundleDiff(before, next).learnerVisible).toBe(true);
  });

  it('a budgets-only change is marked so (it skips the ladder)', () => {
    const next = seed();
    next.settings.runCeilingUsd = 0.4;
    const d = bundleDiff(seed(), next);
    expect(d.settings).toEqual([
      { key: 'runCeilingUsd', before: 0.5, after: 0.4 },
    ]);
    expect(d.budgetOnly).toBe(true);
    next.settings.passScore = 8.5;
    expect(bundleDiff(seed(), next).budgetOnly).toBe(false);
  });

  it('finds prompt versions and model swaps', () => {
    const next = seed();
    next.prompts.debrief_writer_system = 13;
    next.recipes.standard.steps.find((s) => s.step === 'writer')!.model =
      'gpt-4.1';
    const d = bundleDiff(seed(), next);
    expect(d.prompts).toEqual([
      { code: 'debrief_writer_system', before: null, after: 13, pinned: false },
    ]);
    expect(d.steps).toEqual([
      expect.objectContaining({
        step: 'writer',
        field: 'model',
        after: 'gpt-4.1',
      }),
    ]);
  });
});

describe('step on/off on a draft', () => {
  it('refuses to turn off a fixed step or touch the judge', () => {
    expect(
      applyStepEdits(seed(), [{ step: 'safety_reader', enabled: false }]),
    ).toEqual({
      problem: 'safety_reader is fixed and cannot be turned off',
    });
    expect(
      'problem' in applyStepEdits(seed(), [{ step: 'judge', model: 'x' }]),
    ).toBe(true);
  });

  it('turning the Reviser off sets revision rounds to 0; on puts it back where it was', () => {
    const off = applyStepEdits(seed(), [{ step: 'reviser', enabled: false }]);
    if ('problem' in off) throw new Error(off.problem);
    expect(off.bundle.recipes.standard.steps.map((s) => s.step)).not.toContain(
      'reviser',
    );
    expect(off.bundle.recipes.standard.maxRevisionRounds).toBe(0);
    expect(validateDebriefBundle(off.bundle)).toEqual([]);
    const on = applyStepEdits(off.bundle, [{ step: 'reviser', enabled: true }]);
    if ('problem' in on) throw new Error(on.problem);
    expect(on.bundle.recipes.standard.steps.map((s) => s.step)).toEqual(
      seed().recipes.standard.steps.map((s) => s.step),
    );
    expect(on.bundle.recipes.standard.maxRevisionRounds).toBeGreaterThan(0);
  });

  it('agents need an orchestrator', () => {
    expect(
      applyStepEdits(seed(), [{ step: 'agent:protocol_check', enabled: true }]),
    ).toEqual({
      problem: 'this release has no orchestrator; agents are off',
    });
  });
});

describe('release notes helpers', () => {
  it('excerpts only the changed part of a prompt', () => {
    const before = `${'a'.repeat(200)} give them a short script. ${'z'.repeat(200)}`;
    const after = `${'a'.repeat(200)} suggest one open question. ${'z'.repeat(200)}`;
    const ex = changedExcerpt(before, after, 10);
    expect(ex.before).toContain('give them a short script');
    expect(ex.after).toContain('suggest one open question');
    expect(ex.before!.length).toBeLessThan(80);
    expect(promptLabel('debrief_reply_system')).toBe('Ask Ally');
  });

  it('ladder and status read from the idea; seed releases skipped it', () => {
    expect(ladderOf(null, 'seed release')[0]).toEqual({
      rung: 'quick_test',
      state: 'skipped',
      detail: 'seed release',
    });
    const idea = {
      evidence: {
        screen: {
          status: 'done',
          passed: true,
          cases: 30,
          pairs: 28,
          lift: 0.4,
        },
        gate: { status: 'running' },
      },
    };
    expect(ladderOf(idea, null).map((r) => r.state)).toEqual([
      'passed',
      'running',
      'waiting',
      'waiting',
    ]);
    expect(displayStatus('draft', idea)).toBe('being_tested');
    expect(displayStatus('shadow', null)).toBe('being_tested');
    expect(displayStatus('ga', null)).toBe('live');
  });
});

describe('ideas are open or closed, like pull requests', () => {
  it('closes on promotion (with its release), expiry, revert and a failed test', () => {
    expect(ideaState({ status: 'active', releaseId: 'r7' })).toMatchObject({
      state: 'closed',
      closedReason: 'promoted',
      releaseId: 'r7',
    });
    expect(
      ideaState({ status: 'rejected', evidence: { expiry: { at: 'x' } } })
        .closedReason,
    ).toBe('expired');
    expect(
      ideaState({
        status: 'proposed',
        evidence: {
          canary: { status: 'reverted', reason: 'missed a risk cue' },
        },
      }),
    ).toMatchObject({
      closedReason: 'reverted',
      closedWhy: 'missed a risk cue',
    });
    expect(
      ideaState({ status: 'proposed', evidence: { gate: { passed: false } } })
        .closedReason,
    ).toBe('did_not_pass');
    expect(
      ideaState({
        status: 'proposed',
        evidence: { trial: { status: 'running' } },
      }).state,
    ).toBe('open');
  });

  it('a proposed change waits for its quick test, or for the owner when it is budgets only', () => {
    const now = new Date('2026-11-13T00:00:00Z');
    const idea = {
      status: 'proposed',
      createdAt: '2026-11-12T00:00:00Z',
      change: { ideaKind: 'release', releaseId: 'r8' },
      evidence: {},
    };
    expect(approvalState(idea, now)!.wait).toBe('start_quick_test');
    expect(
      approvalState(
        { ...idea, change: { ...idea.change, budgetOnly: true } },
        now,
      )!.wait,
    ).toBe('promote_budget');
  });
});
