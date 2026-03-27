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

import {configureStore} from '@reduxjs/toolkit';

import {api} from '../api';
import {scribeReviewThreadsApi} from '../scribeReviewThreadsApi';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() =>
    Promise.resolve(mockOkJsonResponse({data: [], count: 0})),
  );
};

const createTestStore = () =>
  configureStore({
    reducer: {[api.reducerPath]: api.reducer},
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({immutableCheck: false, serializableCheck: false}).concat(
        api.middleware,
      ),
  });

const noSubscribe = {subscribe: false} as const;

describe('scribeReviewThreadsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes scribe thread endpoints', () => {
    const e = (scribeReviewThreadsApi as any).endpoints;
    expect(e.getScribeThreads).toBeTruthy();
    expect(e.getScribeCommentReplies).toBeTruthy();
  });

  it('exports lazy hooks', () => {
    const {useLazyGetScribeThreadsQuery, useLazyGetScribeCommentRepliesQuery} =
      require('../scribeReviewThreadsApi');
    expect(useLazyGetScribeThreadsQuery).toBeDefined();
    expect(useLazyGetScribeCommentRepliesQuery).toBeDefined();
  });

  it('getScribeThreads GETs scribe threads path without pagination', async () => {
    const store = createTestStore();
    await store.dispatch(
      scribeReviewThreadsApi.endpoints.getScribeThreads.initiate(
        {reviewId: 'sr-1'},
        noSubscribe,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('GET');
    expect(url).toContain('v1/scribe-session-reviews/sr-1/threads');
    expect(url).not.toContain('offset=');
  });

  it('getScribeThreads GETs with offset, limit, includeMessage', async () => {
    const store = createTestStore();
    await store.dispatch(
      scribeReviewThreadsApi.endpoints.getScribeThreads.initiate(
        {reviewId: 'sr-2', offset: 0, limit: 20},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=0');
    expect(url).toContain('limit=20');
    expect(url).toContain('includeMessage=true');
  });

  it('getScribeCommentReplies GETs scribe replies path', async () => {
    const store = createTestStore();
    await store.dispatch(
      scribeReviewThreadsApi.endpoints.getScribeCommentReplies.initiate(
        {commentId: 'rep-1'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain(
      'v1/scribe-session-reviews/comments/rep-1/replies',
    );
  });

  it('getScribeCommentReplies GETs with pagination params', async () => {
    const store = createTestStore();
    await store.dispatch(
      scribeReviewThreadsApi.endpoints.getScribeCommentReplies.initiate(
        {commentId: 'rep-2', offset: 3, limit: 7},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=3');
    expect(url).toContain('limit=7');
  });
});
