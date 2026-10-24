import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../../conductor/course-spine';
import { decideSteer, planFirstWin, proseBudget } from '../../conductor/pacing';
import { renderSituationReport } from '../../conductor/situation-report';
import { GuideMessageRole, GuideMode } from '../../enum/guide.enum';
import {
  GUIDE_DEFAULT_BUNDLE,
  GUIDE_DEFAULT_POLICY,
} from '../../release/guide-release.bundle';
import {
  budgetTier,
  decideEpoch,
  estimateTokens,
} from '../../runtime/guide-epoch';
import { checkPresentable } from '../../capabilities/guide-tools';
import {
  buildCourseSpan,
  buildEpochOpener,
  buildLearnerMessage,
  buildOrgSpan,
  buildSystemSpans,
  plainText,
  stripEchoedScaffolding,
} from '../guide-context';
import { recentConversation, replayHistory } from '../guide-history';

const spine = buildCourseSpine(
  {
    id: 'tr1',
    title: 'Course',
    enrolled: true,
    sections: [
      {
        id: 's1',
        title: 'Starting well',
        order: 1,
        items: [
          {
            id: 'i1',
            type: TrackItemType.ARTICLE,
            order: 1,
            title: 'Listening',
            description: '<p>The basics of <b>listening</b>.</p>',
            status: SessionItemStatus.COMPLETED,
          },
          {
            id: 'i2',
            type: TrackItemType.ROLEPLAY,
            order: 2,
            title: 'Meera calls',
            status: SessionItemStatus.UNLOCKED,
          },
          {
            id: 'i3',
            type: TrackItemType.QUIZ,
            order: 3,
            title: 'Check',
            status: SessionItemStatus.LOCKED,
          },
        ],
      },
    ],
  },
  { triggerWarningsByItem: new Map([['i2', ['Suicide']]]) },
);

const course = {
  title: 'First calls',
  description: '<p>How to <i>open</i> a call.</p>',
  languageCode: 'en',
  trainerNotes: 'Learners here are new volunteers.',
  spine,
};

describe('system spans', () => {
  it('orders cache lifetimes longest first and never includes item state', () => {
    const spans = buildSystemSpans(
      GUIDE_DEFAULT_BUNDLE,
      buildOrgSpan(null),
      buildCourseSpan(course),
    );
    expect(spans.blocks.map((b) => b.cache)).toEqual(['1h', '1h', true]);
    const courseText = spans.blocks[2].text;
    expect(courseText).toContain('id="i2"');
    expect(courseText).toContain('content_warnings="Suicide"');
    expect(courseText).toContain('Learners here are new volunteers.');
    expect(courseText).not.toMatch(/completed|unlocked|locked/i);
  });

  it('hashes stably, and changes when the course text changes', () => {
    const a = buildSystemSpans(
      GUIDE_DEFAULT_BUNDLE,
      'org',
      buildCourseSpan(course),
    );
    const b = buildSystemSpans(
      GUIDE_DEFAULT_BUNDLE,
      'org',
      buildCourseSpan(course),
    );
    const c = buildSystemSpans(
      GUIDE_DEFAULT_BUNDLE,
      'org',
      buildCourseSpan({ ...course, trainerNotes: 'Changed.' }),
    );
    expect(a.hashes).toEqual(b.hashes);
    expect(c.hashes.course).not.toBe(a.hashes.course);
    expect(c.hashes.persona).toBe(a.hashes.persona);
  });

  it('shows each lesson only in the span of its scope', () => {
    const bundle = {
      ...GUIDE_DEFAULT_BUNDLE,
      lessonSnapshot: ['Ask before explaining.'],
      playbook: [
        { id: 'p', scope: 'platform' as const, text: 'Ask before explaining.' },
        {
          id: 'o1',
          scope: 'org' as const,
          tenantId: 't1',
          text: 'Org one lesson.',
        },
        {
          id: 'o2',
          scope: 'org' as const,
          tenantId: 't2',
          text: 'Org two lesson.',
        },
        {
          id: 'c',
          scope: 'course' as const,
          trackId: 'tr1',
          text: 'Course lesson.',
        },
      ],
    };
    const spans = buildSystemSpans(bundle, 'org', 'course', {
      tenantId: 't1',
      trackId: 'tr1',
    });
    const [s1, s2, s3] = spans.blocks.map((b) => b.text);
    expect(s1).toContain('Ask before explaining.');
    expect(s1).not.toContain('Org one lesson.');
    expect(s2).toContain('Org one lesson.');
    expect(s2).not.toContain('Org two lesson.');
    expect(s3).toContain('Course lesson.');
    const other = buildSystemSpans(bundle, 'org', 'course', { tenantId: 't2' });
    expect(other.blocks[1].text).toContain('Org two lesson.');
    expect(other.blocks[2].text).not.toContain('Course lesson.');
    // A visitor (no organisation) sees no organisation lesson.
    expect(buildSystemSpans(bundle, 'org', 'course').blocks[1].text).toBe(
      'org',
    );
  });

  it('wraps organisation text as data', () => {
    expect(buildOrgSpan({ protocols: 'Call <supervisor> first' })).toContain(
      'Call ‹supervisor› first',
    );
  });

  it('turns course HTML into text', () => {
    expect(plainText('<p>One &amp; two</p><p>three</p>')).toBe(
      'One & two\nthree',
    );
  });
});

describe('buildLearnerMessage', () => {
  it('carries the opener, intent, anchor and text as data blocks', () => {
    const message = buildLearnerMessage({
      text: 'what does <this> mean?',
      intent: 'continue',
      anchor: { itemId: 'i1', quote: 'stay with silence', timestampSec: 12.7 },
      epochOpener: '<epoch_context>…</epoch_context>',
    });
    const texts = (message.content as any[]).map((b) => b.text);
    expect(texts[0]).toContain('epoch_context');
    expect(texts[1]).toContain('pressed Continue');
    expect(texts[2]).toBe(
      '<asking_about item_id="i1" at_seconds="12">stay with silence</asking_about>',
    );
    expect(texts[3]).toBe(
      '<learner_message>what does ‹this› mean?</learner_message>',
    );
  });
});

describe('replayHistory', () => {
  const rows = [
    {
      seq: 1,
      role: GuideMessageRole.LEARNER,
      turnId: 't1',
      content: 'hi',
      renderedContent: [{ role: 'user', content: 'hi' }],
    },
    {
      seq: 2,
      role: GuideMessageRole.ALLY,
      turnId: 't1',
      content: 'hello',
      providerBlocks: [{ role: 'assistant', content: 'hello' }],
    },
    // A turn that failed: on screen, never in the model's history.
    {
      seq: 3,
      role: GuideMessageRole.LEARNER,
      turnId: 't2',
      content: 'lost',
      renderedContent: null,
    },
    {
      seq: 4,
      role: GuideMessageRole.LEARNER,
      turnId: 't3',
      content: 'again',
      renderedContent: [
        { role: 'user', content: 'again' },
        { role: 'system', content: 'report' },
      ],
    },
    {
      seq: 5,
      role: GuideMessageRole.ALLY,
      turnId: 't3',
      content: 'sure',
      providerBlocks: [{ role: 'assistant', content: 'sure' }],
    },
  ];

  it('replays complete exchanges only, in order', () => {
    expect(replayHistory(rows as never).map((m) => m.content)).toEqual([
      'hi',
      'hello',
      'again',
      'report',
      'sure',
    ]);
  });

  it('recaps what the learner saw, failed turns included', () => {
    expect(recentConversation(rows as never, 3).map((l) => l.text)).toEqual([
      'lost',
      'again',
      'sure',
    ]);
  });
});

describe('decideEpoch', () => {
  const hashes = { persona: 'p', org: 'o', course: 'c' };
  const snapshot = {
    releaseId: 'r1',
    tier: 'premium' as const,
    startedAt: '2026-10-23T10:00:00.000Z',
    layerHashes: hashes,
    emergencyRollbackId: null,
  };
  const now = new Date('2026-10-23T10:30:00Z');
  const decide = (over: Partial<Parameters<typeof decideEpoch>[0]>) =>
    decideEpoch({
      snapshot,
      now,
      lastLearnerActivityAt: new Date('2026-10-23T10:20:00Z'),
      idleMinutes: 60,
      emergencyRollbackId: null,
      tier: 'premium',
      spanHashes: hashes,
      ...over,
    });

  it('continues an active conversation', () => {
    expect(decide({})).toEqual({ continue: true });
  });

  it.each([
    [{ snapshot: null }, 'first conversation'],
    [
      { lastLearnerActivityAt: new Date('2026-10-23T09:00:00Z') },
      'return after a break',
    ],
    [{ emergencyRollbackId: 'audit-9' }, 'safety rollback'],
    [{ tier: 'degraded' as const }, 'budget tier changed'],
    [
      { spanHashes: { ...hashes, course: 'changed' } },
      'course or organisation changed',
    ],
  ])('starts a new epoch for %o', (over, reason) => {
    expect(decide(over as never)).toEqual({ continue: false, reason });
  });

  it('summarises once the history passes the policy threshold, not before', () => {
    expect(
      decide({ historyTokens: 40_000, summariseAboveTokens: 40_000 }),
    ).toEqual({ continue: true });
    expect(
      decide({ historyTokens: 40_001, summariseAboveTokens: 40_000 }),
    ).toEqual({ continue: false, reason: 'conversation summarised' });
  });

  it('lets any other reason win over summarising', () => {
    expect(
      decide({
        tier: 'degraded',
        historyTokens: 90_000,
        summariseAboveTokens: 40_000,
      }),
    ).toEqual({ continue: false, reason: 'budget tier changed' });
  });

  it('estimates a history at about four characters a token', () => {
    expect(estimateTokens([])).toBe(0);
    const history = [{ role: 'user', content: 'x'.repeat(3_986) }];
    expect(estimateTokens(history)).toBe(1_004);
  });
});

describe('the epoch opener', () => {
  it('carries the summary of earlier epochs as data the learner cannot see', () => {
    const opener = buildEpochOpener({
      firstName: null,
      guidance: 'walk',
      recent: [{ role: 'learner', text: 'Where were we?' }],
      reason: 'conversation summarised',
      summary: 'Their goals:\n- Feel calmer on <first> calls',
    });
    expect(opener).toContain('<summary>');
    expect(opener).toContain('- Feel calmer on ‹first› calls');
    expect(opener).toContain('the learner cannot see it');
  });

  it('says nothing about a summary when there is none', () => {
    expect(
      buildEpochOpener({
        firstName: null,
        guidance: 'walk',
        recent: [],
        reason: 'first conversation',
      }),
    ).not.toContain('<summary>');
  });
});

describe('budgetTier', () => {
  const limits = GUIDE_DEFAULT_POLICY.limits;
  it.each([
    [0, 0, 'premium'],
    [3, 0, 'degraded'],
    [0, 1.5, 'degraded'],
    [6, 0, 'lite'],
  ])('thread $%p, learner-day $%p → %s', (threadUsd, learnerDayUsd, tier) => {
    expect(budgetTier({ threadUsd, learnerDayUsd, limits })).toBe(tier);
  });
});

describe('checkPresentable', () => {
  const steer = (mayPresentNext: boolean) => ({
    level: (mayPresentNext ? 3 : 1) as 1 | 3,
    reason: 'test',
    dockVisible: true,
    mayPresentNext,
  });
  const check = (over: Partial<Parameters<typeof checkPresentable>[0]>) =>
    checkPresentable({
      spine,
      steer: steer(false),
      mode: GuideMode.NORMAL,
      itemId: 'i2',
      reason: 'learner_asked',
      alreadyPresentedThisTurn: false,
      ...over,
    });

  it('never presents a locked item', () => {
    expect(
      check({ itemId: 'i3', steer: steer(true), reason: 'next_step' }).ok,
    ).toBe(false);
  });

  it('needs the steer level for next_step, but honours a learner’s ask', () => {
    expect(check({ reason: 'next_step' }).ok).toBe(false);
    expect(check({ reason: 'next_step', steer: steer(true) }).ok).toBe(true);
    expect(check({ reason: 'learner_asked' }).ok).toBe(true);
  });

  it('reopens completed items, one card per turn, nothing in a crisis', () => {
    expect(check({ itemId: 'i1', reason: 'reopen' }).ok).toBe(true);
    expect(check({ alreadyPresentedThisTurn: true }).ok).toBe(false);
    expect(check({ mode: GuideMode.CRISIS }).ok).toBe(false);
  });
});

describe('renderSituationReport', () => {
  const report = (over: Record<string, unknown> = {}) => {
    const pacing = { learnerTurns: 3, offSpineTurns: 0 };
    return renderSituationReport({
      turn: 3,
      mode: GuideMode.NORMAL,
      atmosphere: 'bright',
      channel: 'text',
      guidance: 'walk',
      budget: proseBudget('walk', 'text', 1, GUIDE_DEFAULT_POLICY),
      steer: decideSteer({
        mode: GuideMode.NORMAL,
        pacing,
        spine,
        policy: GUIDE_DEFAULT_POLICY,
        now: Date.now(),
      }),
      spine,
      firstWin: planFirstWin(spine, pacing),
      releaseWindowOpen: false,
      overlay: 'none',
      events: [],
      ...over,
    });
  };

  it('states the budget, steer level, next step and what may be presented', () => {
    const text = report();
    expect(text).toMatch(/^<situation_report turn="3">/);
    expect(text).toContain('at most 60 words');
    expect(text).toContain('steer: level 1');
    expect(text).toContain('next step: "Meera calls"');
    expect(text).toContain('id i2');
    expect(text).toContain('only if the learner asks');
  });

  it('asks for the next step when Continue is pressed and nothing is on screen', () => {
    const steer = {
      level: 3 as const,
      reason: 'learner asked to continue',
      dockVisible: true,
      mayPresentNext: true,
    };
    expect(report({ continuePressed: true, steer })).toContain(
      'present the next step now',
    );
    expect(
      report({ continuePressed: true, steer, nextOnScreen: true }),
    ).not.toContain('present the next step now');
  });

  it('says when the next step is already on screen', () => {
    expect(report({ nextOnScreen: true })).toContain(
      'its card is already on screen',
    );
    expect(report()).not.toContain('already on screen');
  });

  it('tells a platform-started turn to answer the event, not old messages', () => {
    const text = report({ platformTurn: true, mode: GuideMode.CARE });
    expect(text).toContain('started by the platform');
    expect(text).toContain('Do not answer earlier messages again');
    expect(text).toContain('quiet and factual in CARE');
    expect(report()).not.toContain('started by the platform');
  });

  it('carries the CARE and real-case overlays', () => {
    expect(report({ mode: GuideMode.CARE })).toContain('CARE:');
    expect(report({ overlay: 'real_case' })).toContain('REAL CASE');
    expect(report({ overlay: 'pii' })).toContain('IDENTIFYING DETAILS');
  });
});

describe('stripEchoedScaffolding', () => {
  it('drops a line that echoes an intent note or a tag, and keeps the reply', () => {
    expect(
      stripEchoedScaffolding(
        'How are you now, after that roleplay?\nThe learner pressed Continue.',
      ),
    ).toEqual({
      text: 'How are you now, after that roleplay?',
      stripped: true,
    });
    expect(
      stripEchoedScaffolding('Sure.\n<learner_message>next</learner_message>')
        .text,
    ).toBe('Sure.');
    expect(stripEchoedScaffolding('Learner: what now?\nOkay.').text).toBe(
      'Okay.',
    );
  });

  it('leaves an ordinary reply alone, even one that mentions Continue', () => {
    const reply = 'When you are ready, press Continue and we will go on.';
    expect(stripEchoedScaffolding(reply)).toEqual({
      text: reply,
      stripped: false,
    });
  });
});
