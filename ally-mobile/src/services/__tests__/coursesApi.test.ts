jest.mock('@/store/store', () => ({
  store: {dispatch: jest.fn(), getState: jest.fn(() => ({}))},
}));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({type: 'logout'}),
  storeTokens: (p: unknown) => ({type: 'storeTokens', payload: p}),
}));
jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn(async () => undefined),
}));
jest.mock('@/config/env', () => ({
  env: {API_BASE_URL: 'https://example.com', API_VERSION: 'v1'},
}));

import {TrackDetail, TrackItemStatus, TrackItemType} from '@/types';

import {coursesApi} from '../coursesApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const noSubscribe = {subscribe: false} as const;

const buildTrackDetail = (): TrackDetail => ({
  id: 'track-1',
  title: 'Track',
  description: null,
  coverImageUrl: null,
  status: 'ACTIVE',
  totalItems: 1,
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
          type: TrackItemType.VIDEO,
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
          maxWatchedPct: 0,
        },
      ],
    },
  ],
});

describe('coursesApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes all endpoints', () => {
    const e = (coursesApi as any).endpoints;
    expect(e.getLearnTracks).toBeTruthy();
    expect(e.getLearnTrackDetail).toBeTruthy();
    expect(e.getNextTrackItem).toBeTruthy();
    expect(e.enrollTrack).toBeTruthy();
    expect(e.startTrackItem).toBeTruthy();
    expect(e.markArticleRead).toBeTruthy();
    expect(e.reportVideoProgress).toBeTruthy();
    expect(e.submitQuizAttempt).toBeTruthy();
    expect(e.regradeQuizAttempt).toBeTruthy();
    expect(e.saveJournalDraft).toBeTruthy();
    expect(e.submitJournal).toBeTruthy();
  });

  it('getLearnTracks GETs /learn/tracks and unwraps the data array', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(mockOkJsonResponse({data: [{id: 't1'}], count: 1})),
    );
    const store = createApiTestStore();
    const result = await store.dispatch(
      coursesApi.endpoints.getLearnTracks.initiate(undefined, noSubscribe),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/learn/tracks');
    expect(method).toBe('GET');
    expect(result.data).toEqual([{id: 't1'}]);
  });

  it('reportVideoProgress optimistically patches the cached track detail before the request resolves', async () => {
    let resolveProgressFetch: (() => void) | undefined;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(mockOkJsonResponse(buildTrackDetail()))
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveProgressFetch = () =>
              resolve(
                mockOkJsonResponse({
                  completed: false,
                  unlockedItemIds: [],
                  sectionCompleted: false,
                  trackCompleted: false,
                  maxWatchedPct: 40,
                }),
              );
          }),
      );

    const store = createApiTestStore();
    await store.dispatch(
      coursesApi.endpoints.getLearnTrackDetail.initiate({trackId: 'track-1'}),
    );

    const mutationPromise = store.dispatch(
      coursesApi.endpoints.reportVideoProgress.initiate({
        itemId: 'item-1',
        trackId: 'track-1',
        watchedPct: 40,
      }),
    );

    // Flush microtasks until the mocked fetch() for the POST has actually
    // been invoked (registering resolveProgressFetch) — without this, the
    // optimistic-patch dispatch inside onQueryStarted hasn't run yet either,
    // since nothing here has yielded the event loop since dispatch() above.
    for (let i = 0; i < 50 && !resolveProgressFetch; i++) {
      await Promise.resolve();
    }
    expect(resolveProgressFetch).toBeDefined();

    // Before the POST resolves, the cached detail should already reflect the
    // optimistic patch.
    const cachedBeforeResolve = coursesApi.endpoints.getLearnTrackDetail.select(
      {trackId: 'track-1'},
    )(store.getState());
    expect(cachedBeforeResolve.data?.sections[0].items[0].maxWatchedPct).toBe(
      40,
    );

    resolveProgressFetch?.();
    await mutationPromise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidates track tags (triggering a refetch) once reportVideoProgress reports completed: true', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(mockOkJsonResponse(buildTrackDetail()))
      .mockResolvedValueOnce(
        mockOkJsonResponse({
          completed: true,
          unlockedItemIds: [],
          sectionCompleted: true,
          trackCompleted: false,
          maxWatchedPct: 100,
        }),
      )
      .mockResolvedValueOnce(mockOkJsonResponse(buildTrackDetail()));

    const store = createApiTestStore();
    await store.dispatch(
      coursesApi.endpoints.getLearnTrackDetail.initiate({trackId: 'track-1'}),
    );

    await store.dispatch(
      coursesApi.endpoints.reportVideoProgress.initiate({
        itemId: 'item-1',
        trackId: 'track-1',
        watchedPct: 100,
      }),
    );

    // Invalidation triggers an automatic refetch of the still-subscribed
    // getLearnTrackDetail query — a third fetch call.
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('saveJournalDraft does not invalidate anything (no automatic refetch)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(mockOkJsonResponse(buildTrackDetail()))
      .mockResolvedValueOnce(mockOkJsonResponse({success: true}));

    const store = createApiTestStore();
    await store.dispatch(
      coursesApi.endpoints.getLearnTrackDetail.initiate({trackId: 'track-1'}),
    );

    await store.dispatch(
      coursesApi.endpoints.saveJournalDraft.initiate({
        itemId: 'item-1',
        responses: [{promptId: 'p1', response: 'draft text'}],
      }),
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
