import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import { GuideThreadPacing } from '../../entity/guide-thread.entity';
import { GuideMode } from '../../enum/guide.enum';
import { GUIDE_DEFAULT_POLICY } from '../../release/guide-release.bundle';
import { CourseSpine, buildCourseSpine } from '../course-spine';
import {
  afterCompetenceSignal,
  afterDecline,
  afterItemCompleted,
  afterLearnerTurn,
  afterReflection,
  afterVerbalSteer,
  atmosphereOf,
  celebrationFor,
  decideSteer,
  planFirstWin,
  proseBudget,
  releaseWindowOpen,
} from '../pacing';

const policy = GUIDE_DEFAULT_POLICY;
const NOW = Date.parse('2026-10-23T12:00:00Z');

function spineWith(
  types: Array<[TrackItemType, SessionItemStatus]>,
  warnings: Record<string, string[]> = {},
  meta: Record<string, Record<string, unknown>> = {},
): CourseSpine {
  return buildCourseSpine(
    {
      id: 't',
      title: 'Course',
      enrolled: true,
      sections: [
        {
          id: 's1',
          title: 'One',
          order: 1,
          items: types.map(([type, status], index) => ({
            id: `i${index + 1}`,
            type,
            order: index,
            title: `Item ${index + 1}`,
            status,
            contentMeta: meta[`i${index + 1}`] ?? null,
          })),
        },
      ],
    },
    { triggerWarningsByItem: new Map(Object.entries(warnings)) },
  );
}

const SPINE = spineWith([
  [TrackItemType.ARTICLE, SessionItemStatus.COMPLETED],
  [TrackItemType.VIDEO, SessionItemStatus.UNLOCKED],
  [TrackItemType.ROLEPLAY, SessionItemStatus.LOCKED],
]);

const steer = (
  pacing: GuideThreadPacing,
  extra: Partial<Parameters<typeof decideSteer>[0]> = {},
) =>
  decideSteer({
    mode: GuideMode.NORMAL,
    pacing,
    spine: SPINE,
    policy,
    now: NOW,
    ...extra,
  });

describe('decideSteer', () => {
  it('defaults to the dock only (L1)', () => {
    expect(steer({ learnerTurns: 1, offSpineTurns: 1 })).toMatchObject({
      level: 1,
      dockVisible: true,
      mayPresentNext: false,
    });
  });

  it.each([GuideMode.CARE, GuideMode.CRISIS, GuideMode.CRISIS_FOLLOWUP])(
    'goes silent with the dock hidden in %s',
    (mode) => {
      expect(steer({ offSpineTurns: 9 }, { mode })).toMatchObject({
        level: 0,
        dockVisible: false,
      });
    },
  );

  it('honours "continue" from the learner even in CARE, but not in a crisis', () => {
    expect(steer({}, { mode: GuideMode.CARE, learnerReady: true }).level).toBe(
      3,
    );
    expect(
      steer({}, { mode: GuideMode.CRISIS_FOLLOWUP, learnerReady: true }).level,
    ).toBe(3);
    expect(
      steer({}, { mode: GuideMode.CRISIS, learnerReady: true }).level,
    ).toBe(0);
  });

  it('stays silent while an item is open', () => {
    expect(steer({ offSpineTurns: 9 }, { itemOpen: true }).level).toBe(0);
  });

  it('keeps the release window quiet for its turns, then lets go', () => {
    const opened = afterItemCompleted(
      { learnerTurns: 10 },
      { id: 'i3', tension: 'high' },
      new Date(NOW),
    );
    expect(steer({ ...opened, offSpineTurns: 9 }).level).toBe(0);
    expect(steer({ ...opened, learnerTurns: 15, offSpineTurns: 9 }).level).toBe(
      0,
    );
    expect(steer({ ...opened, learnerTurns: 16, offSpineTurns: 9 }).level).toBe(
      3,
    );
  });

  it('closes the release window early once the learner has reflected', () => {
    const opened = afterItemCompleted(
      { learnerTurns: 10 },
      { id: 'i3', tension: 'high' },
      new Date(NOW),
    );
    const reflected = afterReflection(opened);
    expect(releaseWindowOpen(reflected, policy.releaseWindowMaxTurns)).toBe(
      false,
    );
  });

  it('does not open a window after a low-tension item', () => {
    const done = afterItemCompleted(
      { learnerTurns: 3 },
      { id: 'i2', tension: 'low' },
      new Date(NOW),
    );
    expect(done.releaseWindow ?? null).toBeNull();
  });

  it('respects "not now" for the cooldown', () => {
    const declined = afterDecline({ learnerTurns: 5, offSpineTurns: 9 });
    expect(steer({ ...declined }).level).toBe(0);
    expect(steer({ ...declined, learnerTurns: 10 }).level).toBe(0);
    expect(steer({ ...declined, learnerTurns: 11 }).level).toBe(3);
  });

  it('may present the next item right after a completion', () => {
    expect(steer({ learnerTurns: 2 }, { justCompleted: true })).toMatchObject({
      level: 3,
      mayPresentNext: true,
    });
  });

  it('bridges out loud after four turns off the course (L2), once', () => {
    expect(steer({ learnerTurns: 4, offSpineTurns: 4 }).level).toBe(2);
    const bridged = afterVerbalSteer({ learnerTurns: 4, offSpineTurns: 4 });
    expect(steer({ ...bridged, learnerTurns: 5, offSpineTurns: 5 }).level).toBe(
      1,
    );
  });

  it('bridges after six minutes without progress if the learner is chatting', () => {
    const lastProgressAt = new Date(NOW - 7 * 60_000).toISOString();
    expect(steer({ offSpineTurns: 1, lastProgressAt }).level).toBe(2);
    expect(steer({ offSpineTurns: 0, lastProgressAt }).level).toBe(1);
  });

  it('may present the next item after eight turns off the course (L3)', () => {
    expect(steer({ learnerTurns: 8, offSpineTurns: 8 }).level).toBe(3);
  });

  it('is silent when the course is finished', () => {
    const finished = spineWith([
      [TrackItemType.ARTICLE, SessionItemStatus.COMPLETED],
    ]);
    expect(
      decideSteer({
        mode: GuideMode.NORMAL,
        pacing: { offSpineTurns: 9 },
        spine: finished,
        policy,
        now: NOW,
      }),
    ).toMatchObject({ level: 0, reason: 'course finished' });
  });
});

describe('pacing transitions', () => {
  it('counts learner turns and off-course turns', () => {
    let pacing: GuideThreadPacing = {};
    pacing = afterLearnerTurn(pacing, false);
    pacing = afterLearnerTurn(pacing, false);
    expect(pacing).toMatchObject({ learnerTurns: 2, offSpineTurns: 2 });
    pacing = afterLearnerTurn(pacing, true);
    expect(pacing).toMatchObject({ learnerTurns: 3, offSpineTurns: 0 });
  });

  it('records the first win once', () => {
    const first = afterItemCompleted(
      {},
      { id: 'a', tension: 'low' },
      new Date(NOW),
    );
    const second = afterItemCompleted(
      first,
      { id: 'b', tension: 'low' },
      new Date(NOW + 60_000),
    );
    expect(second.firstWinAt).toBe(new Date(NOW).toISOString());
  });

  it('fades in steps to the floor and no further', () => {
    let pacing: GuideThreadPacing = { fadeLevel: 0.5 };
    for (let i = 0; i < 5; i++)
      pacing = afterCompetenceSignal(pacing, policy.fade);
    expect(pacing.fadeLevel).toBe(policy.fade.floor);
  });
});

describe('planFirstWin', () => {
  it('uses a short first item as the win', () => {
    const spine = spineWith(
      [[TrackItemType.ARTICLE, SessionItemStatus.UNLOCKED]],
      {},
      {},
    );
    expect(planFirstWin(spine, {})).toEqual({ kind: 'item', itemId: 'i1' });
  });

  it('warms up before a long first item', () => {
    const spine = spineWith(
      [[TrackItemType.VIDEO, SessionItemStatus.UNLOCKED]],
      {},
      { i1: { durationSeconds: 1200 } },
    );
    expect(planFirstWin(spine, {})).toEqual({
      kind: 'warm_up',
      itemId: 'i1',
      reason: 'long_first_item',
    });
  });

  it('warms up before a boss that comes first', () => {
    const spine = spineWith([
      [TrackItemType.ROLEPLAY, SessionItemStatus.UNLOCKED],
    ]);
    expect(planFirstWin(spine, {})).toMatchObject({ reason: 'boss_first' });
  });

  it('is done once anything was completed, here or in classic', () => {
    expect(planFirstWin(SPINE, {})).toEqual({ kind: 'done' });
  });
});

describe('proseBudget', () => {
  it('follows the dial and caps voice by sentences', () => {
    expect(proseBudget('lead', 'text', 1, policy)).toEqual({
      maxWords: 90,
      maxSentences: null,
    });
    expect(proseBudget('drive', 'voice', 1, policy)).toEqual({
      maxWords: 25,
      maxSentences: 2,
    });
  });

  it('shrinks with fade but never below the "I\'ll drive" budget', () => {
    expect(proseBudget('lead', 'text', 0.5, policy).maxWords).toBe(45);
    expect(proseBudget('walk', 'text', 0.1, policy).maxWords).toBe(25);
  });
});

describe('atmosphereOf', () => {
  it('is still in a crisis and hushed in care or a release window', () => {
    expect(
      atmosphereOf({
        mode: GuideMode.CRISIS,
        releaseWindowOpen: false,
        spine: SPINE,
      }),
    ).toBe('still');
    expect(
      atmosphereOf({
        mode: GuideMode.CARE,
        releaseWindowOpen: false,
        spine: SPINE,
      }),
    ).toBe('hushed');
    expect(
      atmosphereOf({
        mode: GuideMode.NORMAL,
        releaseWindowOpen: true,
        spine: SPINE,
      }),
    ).toBe('hushed');
  });

  it('hushes a chapter that carries trigger warnings', () => {
    const heavy = spineWith(
      [
        [TrackItemType.ARTICLE, SessionItemStatus.UNLOCKED],
        [TrackItemType.ROLEPLAY, SessionItemStatus.LOCKED],
      ],
      { i2: ['Suicide'] },
    );
    expect(
      atmosphereOf({
        mode: GuideMode.NORMAL,
        releaseWindowOpen: false,
        spine: heavy,
      }),
    ).toBe('hushed');
    expect(
      atmosphereOf({
        mode: GuideMode.NORMAL,
        releaseWindowOpen: false,
        spine: SPINE,
      }),
    ).toBe('bright');
  });
});

describe('celebrationFor', () => {
  const boss = { boss: true, triggerWarnings: [], tension: 'high' as const };
  it('is festive only for a clean boss or the finale, in bright', () => {
    expect(
      celebrationFor({
        mode: GuideMode.NORMAL,
        atmosphere: 'bright',
        item: boss,
        courseFinished: false,
      }),
    ).toBe('festive');
    expect(
      celebrationFor({
        mode: GuideMode.NORMAL,
        atmosphere: 'bright',
        item: { ...boss, triggerWarnings: ['Abuse'] },
        courseFinished: false,
      }),
    ).toBe('warm');
  });

  it('is capped at quiet when hushed and absent around a crisis', () => {
    expect(
      celebrationFor({
        mode: GuideMode.NORMAL,
        atmosphere: 'hushed',
        item: boss,
        courseFinished: true,
      }),
    ).toBe('quiet');
    expect(
      celebrationFor({
        mode: GuideMode.CRISIS_FOLLOWUP,
        atmosphere: 'hushed',
        item: boss,
        courseFinished: true,
      }),
    ).toBe('none');
  });
});
