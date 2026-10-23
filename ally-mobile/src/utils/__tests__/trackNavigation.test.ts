import {TrackDetail, TrackItemStatus, TrackItemType} from '@/types';

import {findNextItemId} from '../trackNavigation';

const buildItem = (
  overrides: Partial<TrackDetail['sections'][number]['items'][number]>,
) => ({
  id: 'item',
  type: TrackItemType.ARTICLE,
  order: 0,
  title: 'Item',
  description: null,
  scenarioId: null,
  caseId: null,
  completionCriteria: null,
  contentMeta: null,
  status: TrackItemStatus.LOCKED,
  startedAt: null,
  completedAt: null,
  score: null,
  attemptCount: null,
  maxWatchedPct: null,
  ...overrides,
});

const buildTrack = (
  sections: TrackDetail['sections'],
): TrackDetail => ({
  id: 'track-1',
  title: 'Track',
  description: null,
  coverImageUrl: null,
  status: 'ACTIVE',
  totalItems: sections.flatMap(s => s.items).length,
  estimatedDurationMinutes: null,
  enrolled: true,
  trackEnrollmentId: 'enrollment-1',
  completedItems: 0,
  completedAt: null,
  sections,
});

describe('findNextItemId', () => {
  it('returns null when there is no track', () => {
    expect(findNextItemId(undefined)).toBeNull();
  });

  it('returns null when nothing is unlocked', () => {
    const track = buildTrack([
      {
        id: 's1',
        title: 'Section 1',
        description: null,
        order: 0,
        items: [buildItem({id: 'item-1', status: TrackItemStatus.LOCKED})],
      },
    ]);
    expect(findNextItemId(track)).toBeNull();
  });

  it('prefers an in-progress (unlocked + started) item over a plain unlocked one', () => {
    const track = buildTrack([
      {
        id: 's1',
        title: 'Section 1',
        description: null,
        order: 0,
        items: [
          buildItem({id: 'item-1', order: 0, status: TrackItemStatus.UNLOCKED}),
          buildItem({
            id: 'item-2',
            order: 1,
            status: TrackItemStatus.UNLOCKED,
            startedAt: '2026-01-01T00:00:00.000Z',
          }),
        ],
      },
    ]);
    expect(findNextItemId(track)).toBe('item-2');
  });

  it('falls back to the first unlocked item across sections in order', () => {
    const track = buildTrack([
      {
        id: 's1',
        title: 'Section 1',
        description: null,
        order: 0,
        items: [buildItem({id: 'item-1', status: TrackItemStatus.COMPLETED})],
      },
      {
        id: 's2',
        title: 'Section 2',
        description: null,
        order: 1,
        items: [
          buildItem({id: 'item-2', order: 0, status: TrackItemStatus.LOCKED}),
          buildItem({id: 'item-3', order: 1, status: TrackItemStatus.UNLOCKED}),
        ],
      },
    ]);
    expect(findNextItemId(track)).toBe('item-3');
  });

  it('respects section and item order rather than array order', () => {
    const track = buildTrack([
      {
        id: 's2',
        title: 'Section 2',
        description: null,
        order: 1,
        items: [buildItem({id: 'item-2', order: 0, status: TrackItemStatus.UNLOCKED})],
      },
      {
        id: 's1',
        title: 'Section 1',
        description: null,
        order: 0,
        items: [buildItem({id: 'item-1', order: 0, status: TrackItemStatus.UNLOCKED})],
      },
    ]);
    expect(findNextItemId(track)).toBe('item-1');
  });
});
