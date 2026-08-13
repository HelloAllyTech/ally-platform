import {TrackDetail, TrackItemStatus, TrackItemType} from '@/types';

import {applyCompletionToDetailDraft} from '../trackCompletion';

const buildDraft = (): TrackDetail => ({
  id: 'track-1',
  title: 'Track',
  description: null,
  coverImageUrl: null,
  status: 'ACTIVE',
  totalItems: 3,
  estimatedDurationMinutes: null,
  enrolled: true,
  trackEnrollmentId: 'enrollment-1',
  completedItems: 0,
  completedAt: null,
  sections: [
    {
      id: 'section-1',
      title: 'Section 1',
      description: null,
      order: 0,
      items: [
        {
          id: 'item-1',
          type: TrackItemType.ARTICLE,
          order: 0,
          title: 'Item 1',
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
        },
        {
          id: 'item-2',
          type: TrackItemType.ARTICLE,
          order: 1,
          title: 'Item 2',
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
        },
      ],
    },
  ],
});

describe('applyCompletionToDetailDraft', () => {
  it('does nothing when the result is not completed', () => {
    const draft = buildDraft();
    applyCompletionToDetailDraft(draft, 'item-1', {
      completed: false,
      unlockedItemIds: [],
      sectionCompleted: false,
      trackCompleted: false,
    });

    expect(draft.sections[0].items[0].status).toBe(TrackItemStatus.UNLOCKED);
    expect(draft.completedItems).toBe(0);
  });

  it('marks the completed item COMPLETED and bumps completedItems', () => {
    const draft = buildDraft();
    applyCompletionToDetailDraft(draft, 'item-1', {
      completed: true,
      unlockedItemIds: [],
      sectionCompleted: false,
      trackCompleted: false,
    });

    const item = draft.sections[0].items[0];
    expect(item.status).toBe(TrackItemStatus.COMPLETED);
    expect(item.completedAt).not.toBeNull();
    expect(draft.completedItems).toBe(1);
  });

  it('unlocks items in unlockedItemIds that were LOCKED', () => {
    const draft = buildDraft();
    applyCompletionToDetailDraft(draft, 'item-1', {
      completed: true,
      unlockedItemIds: ['item-2'],
      sectionCompleted: false,
      trackCompleted: false,
    });

    expect(draft.sections[0].items[1].status).toBe(TrackItemStatus.UNLOCKED);
  });

  it('does not double-count an item that is already COMPLETED', () => {
    const draft = buildDraft();
    draft.sections[0].items[0].status = TrackItemStatus.COMPLETED;
    draft.sections[0].items[0].completedAt = '2026-01-01T00:00:00.000Z';
    draft.completedItems = 1;

    applyCompletionToDetailDraft(draft, 'item-1', {
      completed: true,
      unlockedItemIds: [],
      sectionCompleted: false,
      trackCompleted: false,
    });

    expect(draft.completedItems).toBe(1);
    expect(draft.sections[0].items[0].completedAt).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('caps completedItems at totalItems', () => {
    const draft = buildDraft();
    draft.totalItems = 1;
    draft.completedItems = 1;

    applyCompletionToDetailDraft(draft, 'item-1', {
      completed: true,
      unlockedItemIds: [],
      sectionCompleted: false,
      trackCompleted: false,
    });

    expect(draft.completedItems).toBe(1);
  });

  it('sets completedAt on the track when trackCompleted is true', () => {
    const draft = buildDraft();
    applyCompletionToDetailDraft(draft, 'item-1', {
      completed: true,
      unlockedItemIds: [],
      sectionCompleted: false,
      trackCompleted: true,
    });

    expect(draft.completedAt).not.toBeNull();
  });

  it('does not overwrite an existing track completedAt', () => {
    const draft = buildDraft();
    draft.completedAt = '2026-01-01T00:00:00.000Z';

    applyCompletionToDetailDraft(draft, 'item-1', {
      completed: true,
      unlockedItemIds: [],
      sectionCompleted: false,
      trackCompleted: true,
    });

    expect(draft.completedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
