import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import {
  LearnerTrackItemView,
  LearnerTrackView,
  buildCourseSpine,
  estimateMinutes,
  isQuickWin,
  itemTension,
} from '../course-spine';

const item = (
  id: string,
  type: TrackItemType,
  status: SessionItemStatus,
  extra: Partial<LearnerTrackItemView> = {},
): LearnerTrackItemView => ({
  id,
  type,
  order: Number(id.replace(/\D/g, '')) || 0,
  title: `Item ${id}`,
  status,
  ...extra,
});

const view = (
  sections: LearnerTrackView['sections'],
  enrolled = true,
): LearnerTrackView => ({ id: 'track-1', title: 'Course', enrolled, sections });

describe('buildCourseSpine', () => {
  const sections: LearnerTrackView['sections'] = [
    {
      id: 's2',
      title: 'Second',
      order: 2,
      items: [
        item('i4', TrackItemType.ROLEPLAY, SessionItemStatus.LOCKED),
        item('i3', TrackItemType.QUIZ, SessionItemStatus.LOCKED),
      ],
    },
    {
      id: 's1',
      title: 'First',
      order: 1,
      items: [
        item('i2', TrackItemType.VIDEO, SessionItemStatus.UNLOCKED),
        item('i1', TrackItemType.ARTICLE, SessionItemStatus.COMPLETED, {
          completedAt: new Date('2026-10-20T10:00:00Z'),
        }),
      ],
    },
  ];

  it('orders chapters and items, and finds the current and upcoming items', () => {
    const spine = buildCourseSpine(view(sections));
    expect(spine.items.map((i) => i.id)).toEqual(['i1', 'i2', 'i3', 'i4']);
    expect(spine.items.map((i) => i.position)).toEqual([0, 1, 2, 3]);
    expect(spine.items.map((i) => i.sectionIndex)).toEqual([0, 0, 1, 1]);
    expect(spine.current?.id).toBe('i2');
    expect(spine.upcoming?.id).toBe('i3');
    expect(spine.completed).toBe(1);
    expect(spine.total).toBe(4);
    expect(spine.finished).toBe(false);
    expect(spine.items[0].completedAt).toBe('2026-10-20T10:00:00.000Z');
  });

  it('mirrors classic progression exactly: locked stays locked', () => {
    const spine = buildCourseSpine(view(sections));
    expect(spine.items.find((i) => i.id === 'i3')?.state).toBe('locked');
    expect(spine.items.find((i) => i.id === 'i2')?.state).toBe('available');
    expect(spine.items.find((i) => i.id === 'i1')?.state).toBe('completed');
  });

  it('treats everything as locked before enrolment', () => {
    const spine = buildCourseSpine(view(sections, false));
    expect(spine.items.every((i) => i.state === 'locked')).toBe(true);
    expect(spine.current).toBeNull();
  });

  it('marks roleplays and cases as bosses, and raises tension on trigger warnings', () => {
    const spine = buildCourseSpine(view(sections), {
      triggerWarningsByItem: new Map([['i2', ['Self-harm']]]),
    });
    const byId = new Map(spine.items.map((i) => [i.id, i]));
    expect(byId.get('i4')?.boss).toBe(true);
    expect(byId.get('i3')?.boss).toBe(false);
    expect(byId.get('i2')?.tension).toBe('high');
    expect(byId.get('i2')?.triggerWarnings).toEqual(['Self-harm']);
    expect(byId.get('i1')?.tension).toBe('low');
  });

  it("lets the trainer's per-item tension win", () => {
    const spine = buildCourseSpine(view(sections), {
      guideNotes: { tension: { i4: 'medium', i1: 'high' } },
    });
    const byId = new Map(spine.items.map((i) => [i.id, i]));
    expect(byId.get('i4')?.tension).toBe('medium');
    expect(byId.get('i1')?.tension).toBe('high');
  });

  it('reports a finished course', () => {
    const spine = buildCourseSpine(
      view([
        {
          id: 's1',
          title: 'Only',
          order: 1,
          items: [item('i1', TrackItemType.GAME, SessionItemStatus.COMPLETED)],
        },
      ]),
    );
    expect(spine.finished).toBe(true);
    expect(spine.current).toBeNull();
  });

  it('handles an empty course', () => {
    const spine = buildCourseSpine(view([]));
    expect(spine).toMatchObject({ total: 0, finished: false, current: null });
  });
});

describe('estimateMinutes', () => {
  it('uses a video’s own length plus a little per interjection', () => {
    expect(
      estimateMinutes(
        item('v', TrackItemType.VIDEO, SessionItemStatus.UNLOCKED, {
          contentMeta: { durationSeconds: 240, interjectionCount: 2 },
        }),
      ),
    ).toBe(5);
  });

  it('allows a newcomer half again over an article’s minimum read time', () => {
    expect(
      estimateMinutes(
        item('a', TrackItemType.ARTICLE, SessionItemStatus.UNLOCKED, {
          completionCriteria: { minReadSeconds: 120 },
          contentMeta: { questionCount: 0 },
        }),
      ),
    ).toBe(3);
  });

  it('scales a quiz by its questions', () => {
    expect(
      estimateMinutes(
        item('q', TrackItemType.QUIZ, SessionItemStatus.UNLOCKED, {
          contentMeta: { questionCount: 4 },
        }),
      ),
    ).toBe(5);
  });

  it('falls back to a generous per-type default and never says zero', () => {
    expect(
      estimateMinutes(
        item('r', TrackItemType.ROLEPLAY, SessionItemStatus.LOCKED),
      ),
    ).toBe(12);
    expect(
      estimateMinutes(
        item('b', TrackItemType.BUCKET_SORT, SessionItemStatus.LOCKED, {
          contentMeta: { itemCount: 1 },
        }),
      ),
    ).toBe(1);
  });
});

describe('isQuickWin', () => {
  it.each([
    [
      'an article with no stated read time',
      TrackItemType.ARTICLE,
      {},
      {},
      true,
    ],
    [
      'an article with a 10-minute minimum',
      TrackItemType.ARTICLE,
      { minReadSeconds: 600 },
      {},
      false,
    ],
    ['a game', TrackItemType.GAME, {}, {}, true],
    [
      'a 4-minute video',
      TrackItemType.VIDEO,
      {},
      { durationSeconds: 240 },
      true,
    ],
    ['a video of unknown length', TrackItemType.VIDEO, {}, {}, false],
    ['a 5-question quiz', TrackItemType.QUIZ, {}, { questionCount: 5 }, true],
    ['a 6-question quiz', TrackItemType.QUIZ, {}, { questionCount: 6 }, false],
    ['a journal', TrackItemType.JOURNAL, {}, {}, false],
  ])('%s → %s', (_label, type, criteria, meta, expected) => {
    expect(
      isQuickWin(
        item('x', type as TrackItemType, SessionItemStatus.UNLOCKED, {
          completionCriteria: criteria,
          contentMeta: meta,
        }),
      ),
    ).toBe(expected);
  });
});

describe('itemTension', () => {
  it.each([
    [TrackItemType.ROLEPLAY, 'high'],
    [TrackItemType.CASE, 'high'],
    [TrackItemType.QUIZ, 'medium'],
    [TrackItemType.BUCKET_SORT, 'medium'],
    [TrackItemType.ARTICLE, 'low'],
    [TrackItemType.GAME, 'low'],
  ])('%s defaults to %s', (type, tension) => {
    expect(itemTension(type, [])).toBe(tension);
  });
});
