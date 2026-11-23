import { ConflictException } from '@nestjs/common';
import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';
import { DebriefChangesService } from '../service/debrief-changes.service';
import { DebriefSlackService } from '../service/debrief-slack.service';
import { defaultOwnerSettings } from '../constants/debrief-owner-settings.constants';
import {
  ChangeContext,
  changeKindLabel,
  changeState,
  IdeaRow,
  plainChangeTitle,
  toDebriefChange,
} from '../util/debrief-changes.util';
import { approvalState } from '../util/debrief-console-view.util';

const ID = '11111111-1111-1111-1111-111111111111';
const ctx: ChangeContext = {
  gaReleaseId: 'rel-new',
  canaryMinRuns: 40,
  canaryMinDays: 3,
  pairedMinComparisons: 30,
};
const idea = (over: Partial<IdeaRow> = {}): IdeaRow => ({
  id: ID,
  status: 'proposed',
  text: 'Quote the learner in the Writer’s first card',
  createdAt: '2026-11-10T05:00:00Z',
  updatedAt: '2026-11-12T05:00:00Z',
  releaseId: null,
  change: { ideaKind: 'prompt_edit', promptCode: 'debrief_writer_system' },
  evidence: { hypothesis: 'Learners trust a card that quotes them.' },
  ...over,
});

describe('a change in the owner’s words (v2 Changes)', () => {
  it('maps every rung to a ChangeState', () => {
    // No test has started: proposed, not "being tried".
    expect(changeState(idea())).toBe('proposed');
    expect(
      changeState(idea({ evidence: { trial: { status: 'passed' } } })),
    ).toBe('testing');
    expect(
      changeState(
        idea({
          evidence: {
            trial: { status: 'passed', decidedAt: '2026-11-11' },
            ask: {
              kind: 'low_confidence',
              waitsBecause: 'The Debrief PM agent is not sure about it.',
            },
          },
        }),
      ),
    ).toBe('waits');
    expect(
      changeState(idea({ evidence: { canary: { status: 'running' } } })),
    ).toBe('trying');
    expect(changeState(idea({ status: 'active' }))).toBe('live');
    expect(
      changeState(idea({ status: 'retired', evidence: { undo: { at: 'x' } } })),
    ).toBe('undone');
    expect(
      changeState(
        idea({ status: 'retired', evidence: { stopped: { at: 'x' } } }),
      ),
    ).toBe('stopped');
    expect(
      changeState(
        idea({
          status: 'rejected',
          evidence: { canary: { status: 'reverted' } },
        }),
      ),
    ).toBe('stopped');
    expect(changeState(idea({ evidence: { gate: { passed: false } } }))).toBe(
      'stopped',
    );
    expect(
      changeState(
        idea({ status: 'rejected', evidence: { expiry: { at: 'x' } } }),
      ),
    ).toBe('turned_down');
    // Builder: building until the pull request is merged and delivered.
    const builder = idea({
      status: 'approved',
      change: { ideaKind: 'needs_code' },
      evidence: { handoff: { status: 'filed', kind: 'builder', at: 'x' } },
    });
    expect(changeState(builder)).toBe('building');
    expect(
      changeState({
        ...builder,
        evidence: { ...builder.evidence, delivery: { at: '2026-11-12' } },
      }),
    ).toBe('live');
  });

  it('kinds read like "Prompt · Writer", "Pinned rule · Safety reader", "Model · Writer", "Code · Builder"', () => {
    expect(changeKindLabel(idea())).toBe('Prompt · Writer');
    expect(
      changeKindLabel(
        idea({
          change: {
            ideaKind: 'prompt_edit',
            promptCode: 'debrief_safety_reader_system',
          },
        }),
      ),
    ).toBe('Pinned rule · Safety reader');
    expect(
      changeKindLabel(
        idea({
          change: { ideaKind: 'release' },
          evidence: {
            diff: { steps: [{ step: 'writer', field: 'model' }], prompts: [] },
          },
        }),
      ),
    ).toBe('Model · Writer');
    expect(changeKindLabel(idea({ change: { ideaKind: 'needs_code' } }))).toBe(
      'Code · Builder',
    );
    expect(
      changeKindLabel(idea({ change: { ideaKind: 'test_settings' } })),
    ).toBe('Setting · Tests');
  });

  it('a live change: headline, steps, measures, Undo now only while it is the live release', () => {
    const live = idea({
      status: 'active',
      releaseId: 'rel-new',
      evidence: {
        hypothesis: 'Learners trust a card that quotes them.',
        confidence: 'high',
        screen: { passed: true, lift: 0.4 },
        gate: { passed: true },
        trial: { status: 'passed', comparisons: 30, meanDifference: 0.3 },
        canary: {
          status: 'promoted',
          share: 0.1,
          canaryRuns: 44,
          canaryMedian: 8.1,
          controlMedian: 7.9,
        },
        watch: {
          status: 'watching',
          releaseId: 'rel-new',
          previousReleaseId: 'rel-old',
          liveAt: '2026-11-12T05:00:00Z',
          until: '2026-11-26T05:00:00Z',
          last: { after: 7.6, before: 7.3, n: 120 },
        },
      },
    });
    const c = toDebriefChange(live, ctx);
    expect(c).toMatchObject({
      id: ID,
      state: 'live',
      kind: 'Prompt · Writer',
      result:
        'Live for everyone since 12 Nov; watched until 26 Nov. Score 7.6, was 7.3.',
      why: 'Learners trust a card that quotes them.',
      when: 'live since 12 Nov',
      waitsBecause: null,
      confidence: 'high',
      languages: null,
      canUndo: true,
      canStop: false,
    });
    expect(c.measures[0]).toEqual({
      name: 'Score since it went live',
      value: '7.6 (was 7.3)',
      tone: 'up',
    });
    expect(c.steps.map((s) => [s.name, s.state])).toEqual([
      ['Quick check', 'Passed'],
      ['Pass test', 'Passed'],
      ['Side-by-side on real sessions', 'Passed'],
      ['Tried on some learners', 'Passed'],
      ['Live for everyone', 'Done'],
      ['Watched', 'Watching'],
    ]);
    // A later change is live: no Undo now on this one.
    expect(
      toDebriefChange(live, { ...ctx, gaReleaseId: 'rel-later' }).canUndo,
    ).toBe(false);
    // Plain words: no jargon in the headline.
    expect(c.result).not.toMatch(
      /independent check|Safety reader|below the bar/,
    );
  });

  it('a change that waits says why; trying and testing can be stopped', () => {
    const waits = toDebriefChange(
      idea({
        evidence: {
          trial: { status: 'passed', decidedAt: '2026-11-11' },
          ask: {
            kind: 'new_model',
            waitsBecause: 'It brings in a new model: x.',
          },
        },
      }),
      ctx,
    );
    expect(waits).toMatchObject({
      state: 'waits',
      waitsBecause: 'It brings in a new model: x.',
      result: 'Waits for you. It brings in a new model: x.',
      canStop: false,
    });
    const trying = toDebriefChange(
      idea({
        evidence: {
          canary: { status: 'running', share: 0.1, canaryRuns: 12, days: 1 },
        },
      }),
      ctx,
    );
    expect(trying).toMatchObject({
      state: 'trying',
      result: 'Tried on 10% of learners: 12 of 40 debriefs, 1 of 3 days.',
      canStop: true,
    });
  });
});

describe('fields the v2 console needs', () => {
  it('a pinned-rule change carries its key and its wording before and after', () => {
    const c = toDebriefChange(
      idea({
        change: {
          ideaKind: 'pinned_rule',
          promptCode: 'debrief_safety_reader_system',
          find: 'A risk cue is a direct statement.',
          replace: 'A risk cue is a direct or indirect statement.',
        },
      }),
      ctx,
    );
    expect(c.kindKey).toBe('pinned_rule');
    expect(c.wording).toEqual({
      before: 'A risk cue is a direct statement.',
      after: 'A risk cue is a direct or indirect statement.',
    });
  });

  it('other changes have no wording and a short summary line', () => {
    const c = toDebriefChange(
      idea({ change: { ideaKind: 'setting', settingKey: 'passScore' } }),
      ctx,
    );
    expect(c.kindKey).toBe('setting');
    expect(c.wording).toBeNull();
    expect(typeof c.summary).toBe('string');
  });
});

describe('an old pinned-rule sign-off still reads as history', () => {
  const signOff = idea({
    status: 'approved',
    createdAt: '2026-11-12T05:00:00Z',
    change: {
      ideaKind: 'pinned_rule',
      promptCode: 'debrief_quality_judge_system',
      firstVersion: true,
      version: 1,
    },
    evidence: {},
  });

  it('keeps its title, is not waiting for anyone, and has no empty analysis', () => {
    const c = toDebriefChange(signOff, ctx);
    expect(c.title).toBe(
      "Sign off the Judge's instructions (in use since 12 Nov)",
    );
    expect(c.state).toBe('live');
    expect(c.waitsBecause).toBeNull();
    expect(c.basedOn).toBe('');
    expect(c.kindKey).toBe('pinned_rule');
    expect(c).not.toHaveProperty('rule');
  });

  it('never waits, even if one were left open', () => {
    const open = idea({ ...signOff, status: 'proposed' });
    expect(approvalState(open as never)).toBeNull();
    expect(toDebriefChange(open, ctx).state).not.toBe('waits');
  });
});

describe('approvals that wait (v2 A7)', () => {
  it('a passed trial with nothing on the always-ask list never expires', () => {
    const a = approvalState(
      {
        status: 'proposed',
        createdAt: '2026-10-01T00:00:00Z',
        change: { ideaKind: 'prompt_edit' },
        evidence: {
          trial: { status: 'passed', decidedAt: '2026-10-01T00:00:00Z' },
        },
      },
      new Date('2026-11-20T00:00:00Z'),
    )!;
    expect(a).toMatchObject({
      wait: 'start_canary',
      expiresAt: null,
      expired: false,
    });
  });
});

/** A PM agent service with only what `advance` reaches. */
function pm(ideaRow: Record<string, any>, settings: Record<string, any> = {}) {
  const ownerSettings = {
    get: jest.fn(async () => ({ ...defaultOwnerSettings(), ...settings })),
  };
  const notifier = { owner: jest.fn(async () => 1) };
  const svc = new DebriefPmAgentService(
    { query: jest.fn(async () => []) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    ownerSettings as any,
    {} as any,
    {} as any,
    undefined,
    notifier as any,
  );
  jest.spyOn(svc, 'getIdea').mockResolvedValue(ideaRow);
  jest
    .spyOn(svc, 'gaBundle')
    .mockResolvedValue({ bundle: { recipes: {} } } as any);
  const approve = jest
    .spyOn(svc, 'approve')
    .mockResolvedValue({ releaseId: 'r', version: 3, stage: 'canary' });
  const writeEvidence = jest.spyOn(svc, 'writeEvidence').mockResolvedValue();
  jest.spyOn(svc, 'audit').mockResolvedValue();
  return { svc, approve, writeEvidence, notifier };
}

describe('the ladder runs on its own (v2 A3)', () => {
  const passedTrial = {
    id: ID,
    status: 'proposed',
    text: 'Shorter cards',
    change: { ideaKind: 'prompt_edit', promptCode: 'debrief_writer_system' },
    evidence: { trial: { status: 'passed' } },
  };

  it('a passed trial starts its learner try-out with no person', async () => {
    const { svc, approve } = pm(passedTrial);
    expect(await svc.advance(ID)).toBe('started_canary');
    expect(approve).toHaveBeenCalledWith(ID, null);
  });

  it('a passed try-out goes live for everyone by itself', async () => {
    const { svc, approve } = pm({
      ...passedTrial,
      evidence: {
        trial: { status: 'passed' },
        canary: { status: 'passed', releaseId: 'r' },
      },
    });
    approve.mockResolvedValue({
      releaseId: 'r',
      version: 3,
      stage: 'promoted',
    });
    expect(await svc.advance(ID)).toBe('promoted');
    expect(approve).toHaveBeenCalledWith(ID, null);
  });

  it('an always-ask change waits once, records why and tells the owner', async () => {
    const { svc, approve, writeEvidence, notifier } = pm({
      ...passedTrial,
      evidence: {
        ...passedTrial.evidence,
        confidence: { level: 'low', why: 'thin evidence' },
      },
    });
    expect(await svc.advance(ID)).toBe('waits');
    expect(approve).not.toHaveBeenCalled();
    expect(writeEvidence).toHaveBeenCalledWith(
      ID,
      'ask',
      expect.objectContaining({ kind: 'low_confidence', locked: false }),
    );
    expect(notifier.owner).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Debriefs: a change waits for you' }),
    );
  });

  it('after the person’s yes it carries on; with askLowConfidence off it never waited', async () => {
    const yes = pm({
      ...passedTrial,
      evidence: {
        ...passedTrial.evidence,
        confidence: 'low',
        ask: { kind: 'low_confidence' },
        approval: { by: 7, at: 'x' },
      },
    });
    expect(await yes.svc.advance(ID)).toBe('started_canary');
    const off = pm(
      {
        ...passedTrial,
        evidence: { ...passedTrial.evidence, confidence: 'low' },
      },
      { askLowConfidence: false },
    );
    expect(await off.svc.advance(ID)).toBe('started_canary');
  });

  it('nothing moves while the Debrief PM agent is switched off, for hand-offs, budgets or a stopped change', async () => {
    expect(
      await pm(passedTrial, { pmAgentEnabled: false }).svc.advance(ID),
    ).toBe('nothing');
    expect(
      await pm({
        ...passedTrial,
        change: { ideaKind: 'needs_code' },
      }).svc.advance(ID),
    ).toBe('nothing');
    expect(
      await pm({
        ...passedTrial,
        change: { ideaKind: 'release', budgetOnly: true },
      }).svc.advance(ID),
    ).toBe('nothing');
    expect(
      await pm({
        ...passedTrial,
        evidence: { ...passedTrial.evidence, stopped: { at: 'x' } },
      }).svc.advance(ID),
    ).toBe('nothing');
  });

  it('the system may not approve a hand-off or a pinned rule', async () => {
    const { svc, approve } = pm({
      ...passedTrial,
      change: { ideaKind: 'needs_code' },
    });
    approve.mockRestore();
    await expect(svc.approve(ID, null)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

/** The changes service with in-memory ideas. */
function changes(ideaRow: Record<string, any>, over: Record<string, any> = {}) {
  const query = jest.fn(async () => []);
  const evidence: Record<string, any> = {};
  const pmAgent = {
    getIdea: jest.fn(async () => ideaRow),
    writeEvidence: jest.fn(async (_id: string, k: string, v: unknown) => {
      evidence[k] = v;
    }),
    audit: jest.fn(async () => undefined),
    advance: jest.fn(async () => 'nothing'),
  };
  const releases = {
    getGa: jest.fn(async () => ({ id: 'rel-new' })),
    getCanary: jest.fn(async () => ({ id: 'rel-canary' })),
    makeGa: jest.fn(async () => ({ id: 'rel-old', version: 4 })),
    stopCanary: jest.fn(async () => ({})),
    rollbackTarget: jest.fn(async () => null),
  };
  const score = {
    runs: jest.fn(async () => []),
    weights: jest.fn(async () => ({
      quality: 0.4,
      pass: 0.25,
      helpful: 0.2,
      flags: 0.15,
    })),
    gates: jest.fn(async () => ({
      risk: { ok: true, missed: 0, before: 0 },
      cost: { ok: true, p90Usd: 0.3, budgetUsd: 1, over: 0 },
    })),
    view: jest.fn(),
  };
  const settings = {
    get: jest.fn(async () => defaultOwnerSettings()),
    update: jest.fn(async () => defaultOwnerSettings()),
  };
  const slack = {
    post: jest.fn(async () => true),
    sweepSafety: jest.fn(async () => 0),
  };
  const notifier = { owner: jest.fn(async () => 1) };
  const svc = new DebriefChangesService(
    { query } as any,
    pmAgent as any,
    releases as any,
    score as any,
    settings as any,
    slack as any,
    notifier as any,
  );
  Object.assign(releases, over.releases ?? {});
  return {
    svc,
    query,
    pmAgent,
    releases,
    score,
    settings,
    slack,
    notifier,
    evidence,
  };
}

const liveIdea = {
  id: ID,
  status: 'active',
  text: 'Shorter cards',
  releaseId: 'rel-new',
  createdAt: '2026-11-10T00:00:00Z',
  change: { ideaKind: 'prompt_edit', promptCode: 'debrief_writer_system' },
  evidence: {
    watch: {
      status: 'watching',
      releaseId: 'rel-new',
      previousReleaseId: 'rel-old',
      liveAt: '2026-11-12T00:00:00Z',
      until: '2026-11-26T00:00:00Z',
    },
  },
};

describe('Undo now and the watch (v2 A5)', () => {
  it('Undo now puts the release before live for everyone, records it and posts to Slack', async () => {
    const { svc, releases, pmAgent, slack, query } = changes(liveIdea);
    await svc.undo(ID, 7, 'Learners flagged it');
    expect(releases.makeGa).toHaveBeenCalledWith(
      'rel-old',
      7,
      'rolled_back',
      expect.stringContaining('Learners flagged it'),
      'human',
    );
    expect(pmAgent.writeEvidence).toHaveBeenCalledWith(
      ID,
      'undo',
      expect.objectContaining({
        by: 7,
        reason: 'Learners flagged it',
        toReleaseId: 'rel-old',
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'retired'"),
      [ID],
    );
    expect(slack.post).toHaveBeenCalledWith(
      expect.stringContaining('A change was undone by a person: Shorter cards'),
    );
  });

  it('refuses when it is not live, or a later change is live', async () => {
    await expect(
      changes({ ...liveIdea, status: 'proposed', evidence: {} }).svc.undo(
        ID,
        7,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const later = changes(liveIdea);
    later.releases.getGa.mockResolvedValue({ id: 'rel-later' });
    await expect(later.svc.undo(ID, 7)).rejects.toThrow(/later change/);
  });

  it('a test-settings change gets its old values back', async () => {
    const { svc, settings, releases } = changes({
      ...liveIdea,
      releaseId: null,
      change: {
        ideaKind: 'test_settings',
        settings: {
          gateCases: { before: null, after: 150 },
          quickTestCases: { before: 40, after: 60 },
        },
      },
      evidence: {},
    });
    await svc.undo(ID, 7);
    expect(settings.update).toHaveBeenCalledWith(
      { gateCases: null, quickTestCases: 40 },
      7,
      expect.objectContaining({ source: 'undo', changeId: ID }),
    );
    expect(releases.makeGa).not.toHaveBeenCalled();
  });

  it('the watch keeps it after the watch period, and ends when another release is live', async () => {
    const kept = changes(liveIdea);
    expect(
      await kept.svc.watchOne(
        liveIdea as any,
        new Date('2026-11-27T00:00:00Z'),
      ),
    ).toBe(false);
    expect(kept.pmAgent.writeEvidence).toHaveBeenCalledWith(
      ID,
      'watch',
      expect.objectContaining({ status: 'kept' }),
    );
    const other = changes(liveIdea);
    other.releases.getGa.mockResolvedValue({ id: 'rel-later' });
    await other.svc.watchOne(liveIdea as any, new Date('2026-11-14T00:00:00Z'));
    expect(other.pmAgent.writeEvidence).toHaveBeenCalledWith(
      ID,
      'watch',
      expect.objectContaining({ status: 'superseded' }),
    );
  });

  it('undoes on its own when a gate trips, comparing with the release before', async () => {
    const c = changes(liveIdea);
    c.score.gates.mockResolvedValue({
      risk: { ok: false, missed: 2, before: 0 },
      cost: { ok: true, p90Usd: 0.3, budgetUsd: 1, over: 0 },
    });
    expect(
      await c.svc.watchOne(liveIdea as any, new Date('2026-11-14T00:00:00Z')),
    ).toBe(true);
    expect(c.score.runs).toHaveBeenCalledWith(
      expect.any(Date),
      null,
      'rel-new',
    );
    expect(c.score.runs).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'rel-old',
    );
    expect(c.releases.makeGa).toHaveBeenCalledWith(
      'rel-old',
      null,
      'rolled_back',
      expect.any(String),
      'system',
    );
    expect(c.slack.post).toHaveBeenCalledWith(
      expect.stringContaining('undone on its own'),
    );
  });
});

describe('Stop now', () => {
  it('ends the learner try-out and the ladder goes no further', async () => {
    const trying = {
      ...liveIdea,
      status: 'proposed',
      releaseId: null,
      evidence: {
        canary: { status: 'running', releaseId: 'rel-canary', share: 0.1 },
      },
    };
    const { svc, releases, pmAgent } = changes(trying);
    await svc.stop(ID, 7, 'Not now');
    expect(releases.stopCanary).toHaveBeenCalledWith(
      'debrief',
      7,
      false,
      'Not now',
      expect.objectContaining({ detail: { ideaId: ID } }),
    );
    expect(pmAgent.writeEvidence).toHaveBeenCalledWith(
      ID,
      'stopped',
      expect.objectContaining({ by: 7, reason: 'Not now' }),
    );
  });

  it('refuses a live change', async () => {
    await expect(changes(liveIdea).svc.stop(ID, 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('Slack (v2 K1–K3)', () => {
  const build = (
    channel: string,
    token: string | undefined,
    rows: unknown[] = [{ session: 's1' }],
  ) => {
    const sendBlocks = jest.fn(async () => ({ ok: true }));
    const query = jest.fn(async () => rows);
    const svc = new DebriefSlackService(
      { query } as any,
      {
        get: jest.fn(async () => ({
          ...defaultOwnerSettings(),
          slackChannel: channel,
          safetyContact: '<@U1>',
        })),
      } as any,
      { sendBlocks } as any,
      { slack: { botToken: token } } as any,
    );
    return { svc, sendBlocks, query };
  };

  it('posts nothing with no channel or no bot token', async () => {
    const a = build('', 'xoxb');
    expect(await a.svc.post('hi')).toBe(false);
    const b = build('#debriefs', undefined);
    expect(await b.svc.missedRiskCue({ id: 'r1' })).toBe(false);
    expect(a.sendBlocks).not.toHaveBeenCalled();
    expect(b.query).not.toHaveBeenCalled();
  });

  it('a missed clear risk cue names the safety contact, once', async () => {
    const a = build('#debriefs', 'xoxb');
    expect(await a.svc.missedRiskCue({ id: 'r1' })).toBe(true);
    expect(a.query).toHaveBeenCalledWith(
      expect.stringContaining("reviewReason' = 'missed_risk_cue'"),
      ['r1'],
    );
    expect(a.sendBlocks).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: '#debriefs',
        text: expect.stringMatching(
          /^:rotating_light: <@U1> A learner was shown a debrief that missed a clear risk cue/,
        ),
      }),
    );
    // Already posted (the row is marked): nothing again.
    const again = build('#debriefs', 'xoxb', []);
    expect(await again.svc.missedRiskCue({ id: 'r1' })).toBe(false);
    expect(again.sendBlocks).not.toHaveBeenCalled();
  });

  it('distress in Ask Ally goes to the safety contact', async () => {
    const a = build('#debriefs', 'xoxb', [{ id: 'r1' }]);
    await a.svc.chatDistress({ id: 'r1', scenarioSessionId: 's9' });
    expect(a.sendBlocks).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          'A learner showed distress while asking Ally',
        ),
      }),
    );
  });
});

describe('nothing sits untested waiting for a person (review 2026-11-16)', () => {
  it('the hourly watch starts proposed hand-offs and one untested drafted change', async () => {
    const c = changes(liveIdea);
    Object.assign(c.pmAgent, {
      autoStartHandoff: jest.fn(async () => ({ started: true })),
      screen: jest.fn(async () => ({})),
    });
    c.query
      .mockResolvedValueOnce([{ id: 'h1' }, { id: 'h2' }] as never) // hand-offs
      .mockResolvedValueOnce([{ id: 'u1' }] as never) // the oldest untested change
      .mockResolvedValueOnce([] as never) // ready to move on
      .mockResolvedValueOnce([] as never); // watching
    const out = await c.svc.watch(new Date('2026-11-16T00:00:00Z'));
    expect((c.pmAgent as any).autoStartHandoff).toHaveBeenCalledTimes(2);
    expect((c.pmAgent as any).screen).toHaveBeenCalledWith('u1');
    expect(out.moved).toBe(3);
  });

  it('a hand-off or test that cannot start does not stop the watch', async () => {
    const c = changes(liveIdea);
    Object.assign(c.pmAgent, {
      autoStartHandoff: jest.fn(async () => {
        throw new Error('no budget');
      }),
      screen: jest.fn(async () => {
        throw new Error('learning budget spent');
      }),
    });
    c.query
      .mockResolvedValueOnce([{ id: 'h1' }] as never)
      .mockResolvedValueOnce([{ id: 'u1' }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    const out = await c.svc.watch(new Date('2026-11-16T00:00:00Z'));
    expect(out.moved).toBe(0);
  });
});

describe('older budget titles read in plain words', () => {
  it('maps raw setting keys, and leaves other titles alone', () => {
    expect(plainChangeTitle('Settings: monthlyCapUsd')).toBe(
      'Change the monthly cap',
    );
    expect(plainChangeTitle('Settings: runCeilingUsd, passScore')).toBe(
      'Change the most one debrief may spend and the pass mark',
    );
    expect(plainChangeTitle('Monthly cap to $150')).toBe('Monthly cap to $150');
  });
});
