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

import {ReactionAction} from '../reactionsApi';
import {scribeReactionsApi} from '../scribeReactionsApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() => Promise.resolve(mockOkJsonResponse({})));
};

const noSubscribe = {subscribe: false} as const;
const noTrack = {track: false} as const;

describe('scribeReactionsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes all endpoints', () => {
    const e = (scribeReactionsApi as any).endpoints;
    expect(e.getScribeReactions).toBeTruthy();
    expect(e.getScribeReactionsCount).toBeTruthy();
    expect(e.addScribeReactionToComment).toBeTruthy();
    expect(e.addScribeReactionToReview).toBeTruthy();
  });

  it('exports hooks', () => {
    const {
      useLazyGetScribeReactionsQuery,
      useLazyGetScribeReactionsCountQuery,
      useAddScribeReactionToCommentMutation,
      useAddScribeReactionToReviewMutation,
    } = require('../scribeReactionsApi');
    expect(useLazyGetScribeReactionsQuery).toBeDefined();
    expect(useLazyGetScribeReactionsCountQuery).toBeDefined();
    expect(useAddScribeReactionToCommentMutation).toBeDefined();
    expect(useAddScribeReactionToReviewMutation).toBeDefined();
  });

  it('getScribeReactions GETs scribe reactions with offset limit', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReactionsApi.endpoints.getScribeReactions.initiate(
        {reviewId: 'sr-1', offset: 0, limit: 20},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/scribe-session-reviews/sr-1/reactions');
    expect(url).toContain('offset=0');
    expect(url).toContain('limit=20');
  });

  it('getScribeReactions omits reaction param when not provided', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReactionsApi.endpoints.getScribeReactions.initiate(
        {reviewId: 'sr-2', offset: 0, limit: 10},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).not.toContain('reaction=');
  });

  it('getScribeReactions includes reaction when provided', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReactionsApi.endpoints.getScribeReactions.initiate(
        {reviewId: 'sr-3', reaction: '1f44d', offset: 0, limit: 10},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('reaction=1f44d');
  });

  it('getScribeReactionsCount GETs count for numeric reviewId', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReactionsApi.endpoints.getScribeReactionsCount.initiate(42, noSubscribe),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('scribe-session-reviews/42/reactions/count');
  });

  it('addScribeReactionToComment POSTs reaction and action', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReactionsApi.endpoints.addScribeReactionToComment.initiate(
        {id: 'comment-1', reaction: '1f44d', action: ReactionAction.ADD},
        noTrack,
      ),
    );
    const {url, method, body} = await getFirstFetchFromMock(
      global.fetch as jest.Mock,
    );
    expect(method).toBe('POST');
    expect(url).toContain('scribe-session-reviews/comments/comment-1/reactions');
    expect(JSON.parse(body!)).toEqual({
      reaction: '1f44d',
      action: ReactionAction.ADD,
    });
  });

  it('addScribeReactionToReview POSTs to review reactions', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReactionsApi.endpoints.addScribeReactionToReview.initiate(
        {id: 'rev-9', reaction: '2764-fe0f', action: ReactionAction.REMOVE},
        noTrack,
      ),
    );
    const {url, method, body} = await getFirstFetchFromMock(
      global.fetch as jest.Mock,
    );
    expect(method).toBe('POST');
    expect(url).toContain('scribe-session-reviews/rev-9/reactions');
    expect(JSON.parse(body!)).toEqual({
      reaction: '2764-fe0f',
      action: ReactionAction.REMOVE,
    });
  });
});
