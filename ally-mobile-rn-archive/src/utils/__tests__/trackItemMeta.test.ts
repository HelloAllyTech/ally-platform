import {TrackDetailItem, TrackItemStatus, TrackItemType} from '@/types';

import {getTrackItemMeta} from '../trackItemMeta';

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}:${JSON.stringify(options)}` : key;

const buildItem = (overrides: Partial<TrackDetailItem>): TrackDetailItem => ({
  id: 'item-1',
  type: TrackItemType.QUIZ,
  order: 0,
  title: 'Quiz',
  description: null,
  scenarioId: null,
  caseId: null,
  completionCriteria: null,
  contentMeta: null,
  status: TrackItemStatus.UNLOCKED,
  startedAt: null,
  completedAt: null,
  score: null,
  attemptCount: null,
  maxWatchedPct: null,
  ...overrides,
});

describe('getTrackItemMeta', () => {
  it('shows a QUIZ pass score of 0 instead of dropping it', () => {
    const item = buildItem({
      contentMeta: {questionCount: 7, passScore: 0},
    });

    expect(getTrackItemMeta(item, t)).toBe(
      'courses.meta.questions:{"count":7} · courses.meta.passScore:{"score":0}',
    );
  });

  it('shows a real QUIZ pass score', () => {
    const item = buildItem({
      contentMeta: {questionCount: 7, passScore: 70},
    });

    expect(getTrackItemMeta(item, t)).toBe(
      'courses.meta.questions:{"count":7} · courses.meta.passScore:{"score":70}',
    );
  });

  it('omits the QUIZ pass score line when it is not configured at all', () => {
    const item = buildItem({
      contentMeta: {questionCount: 7},
    });

    expect(getTrackItemMeta(item, t)).toBe(
      'courses.meta.questions:{"count":7}',
    );
  });
});
