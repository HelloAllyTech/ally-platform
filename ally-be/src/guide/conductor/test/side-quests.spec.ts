import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../course-spine';
import { GuideMode } from '../../enum/guide.enum';
import { GUIDE_DEFAULT_POLICY } from '../../release/guide-release.bundle';
import { planSideQuest, sideQuestDifficulty } from '../side-quests';

const item = (
  id: string,
  type: TrackItemType,
  status: SessionItemStatus,
  order: number,
) => ({
  id,
  type,
  order,
  title: id,
  status,
});

const spineWith = (done: number) =>
  buildCourseSpine({
    id: 'tr1',
    title: 'Course',
    enrolled: true,
    sections: [
      {
        id: 's1',
        title: 'One',
        order: 1,
        items: [
          item(
            'a1',
            TrackItemType.ARTICLE,
            done > 0 ? SessionItemStatus.COMPLETED : SessionItemStatus.UNLOCKED,
            1,
          ),
          item(
            'v1',
            TrackItemType.VIDEO,
            done > 1
              ? SessionItemStatus.COMPLETED
              : done === 1
                ? SessionItemStatus.UNLOCKED
                : SessionItemStatus.LOCKED,
            2,
          ),
          item(
            'a2',
            TrackItemType.ARTICLE,
            done > 2
              ? SessionItemStatus.COMPLETED
              : done === 2
                ? SessionItemStatus.UNLOCKED
                : SessionItemStatus.LOCKED,
            3,
          ),
          item(
            'q1',
            TrackItemType.QUIZ,
            done === 3 ? SessionItemStatus.UNLOCKED : SessionItemStatus.LOCKED,
            4,
          ),
        ],
      },
      {
        id: 's2',
        title: 'Two',
        order: 2,
        items: [
          item('r1', TrackItemType.ROLEPLAY, SessionItemStatus.LOCKED, 1),
        ],
      },
    ],
  });

const base = (over: Record<string, unknown> = {}) => ({
  spine: spineWith(3),
  pacing: { learnerTurns: 10 },
  guidance: 'walk' as const,
  sideQuestsOn: true,
  mode: GuideMode.NORMAL,
  releaseWindowOpen: false,
  quizOpen: false,
  firstWin: { kind: 'done' as const },
  policy: GUIDE_DEFAULT_POLICY,
  ...over,
});

describe('planSideQuest', () => {
  it('opens after the cadence and suggests a quick check before a quiz', () => {
    expect(planSideQuest(base())).toMatchObject({
      open: true,
      suggested: 'quick_check',
    });
  });

  it('stays closed until enough items since the last one', () => {
    const slot = planSideQuest(
      base({
        pacing: { learnerTurns: 10, sideQuest: { atCompleted: 2, atTurn: 1 } },
      }),
    );
    expect(slot.open).toBe(false);
  });

  it.each([
    [{ sideQuestsOn: false }, 'switched off'],
    [{ mode: GuideMode.CARE }, 'hard moment'],
    [{ releaseWindowOpen: true }, 'release window'],
    [{ quizOpen: true }, 'quiz is open'],
    [{ guidance: 'drive' }, 'only if they ask'],
    [
      { pacing: { learnerTurns: 10, sideQuest: { atTurn: 9 } } },
      'a moment ago',
    ],
  ])('is closed when %o', (over, reason) => {
    const slot = planSideQuest(base(over));
    expect(slot.open).toBe(false);
    expect(slot.reason).toContain(reason);
  });

  it('the first-win warm-up is a side quest', () => {
    expect(
      planSideQuest(
        base({ firstWin: { kind: 'warm_up', reason: 'boss_first' } }),
      ).suggested,
    ).toBe('rehearse_line');
  });

  it('a return after days away invites spaced recall', () => {
    expect(planSideQuest(base({ returnedAfterDays: 3 })).suggested).toBe(
      'spaced_recall',
    );
  });
});

describe('sideQuestDifficulty', () => {
  it('stays standard until it has evidence, then follows the record', () => {
    expect(sideQuestDifficulty({}, 'normal')).toBe('standard');
    expect(
      sideQuestDifficulty({ sideQuest: { answered: 5, correct: 5 } }, 'normal'),
    ).toBe('stretch');
    expect(
      sideQuestDifficulty({ sideQuest: { answered: 5, correct: 1 } }, 'normal'),
    ).toBe('gentle');
    expect(sideQuestDifficulty({}, 'more')).toBe('stretch');
  });
});
