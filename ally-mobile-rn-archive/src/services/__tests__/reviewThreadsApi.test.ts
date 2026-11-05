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

import {reviewThreadsApi} from '../reviewThreadsApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() =>
    Promise.resolve(mockOkJsonResponse({data: [], count: 0})),
  );
};

const noSubscribe = {subscribe: false} as const;

describe('reviewThreadsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes thread endpoints', () => {
    const e = (reviewThreadsApi as any).endpoints;
    expect(e.getThreads).toBeTruthy();
    expect(e.getCommentReplies).toBeTruthy();
  });

  it('exports lazy hooks', () => {
    const {useLazyGetThreadsQuery, useLazyGetCommentRepliesQuery} =
      require('../reviewThreadsApi');
    expect(useLazyGetThreadsQuery).toBeDefined();
    expect(useLazyGetCommentRepliesQuery).toBeDefined();
  });

  it('getThreads GETs without pagination when offset/limit omitted', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewThreadsApi.endpoints.getThreads.initiate(
        {reviewId: 'rev-a'},
        noSubscribe,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('GET');
    expect(url).toContain('v1/scenario-session-reviews/rev-a/threads');
    expect(url).not.toContain('offset=');
    expect(url).not.toContain('includeMessage');
  });

  it('getThreads GETs with offset, limit, includeMessage', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewThreadsApi.endpoints.getThreads.initiate(
        {reviewId: 'rev-b', offset: 2, limit: 10},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=2');
    expect(url).toContain('limit=10');
    expect(url).toContain('includeMessage=true');
  });

  it('getCommentReplies GETs without pagination when offset/limit omitted', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewThreadsApi.endpoints.getCommentReplies.initiate(
        {commentId: 'c-1'},
        noSubscribe,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('GET');
    expect(url).toContain(
      'v1/scenario-session-reviews/comments/c-1/replies',
    );
    expect(url).not.toContain('offset=');
  });

  it('getCommentReplies GETs with offset and limit', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewThreadsApi.endpoints.getCommentReplies.initiate(
        {commentId: 'c-2', offset: 1, limit: 5},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=1');
    expect(url).toContain('limit=5');
  });
});
