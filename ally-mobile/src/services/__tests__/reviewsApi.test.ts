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

import {SortOrder} from '@/constants';
import {ReviewStatus} from '@/types/reviews';

import {reviewsApi} from '../reviewsApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() => Promise.resolve(mockOkJsonResponse({})));
};

const noSubscribe = {subscribe: false} as const;
const noTrack = {track: false} as const;

describe('reviewsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes all endpoints', () => {
    const e = (reviewsApi as any).endpoints;
    expect(e.createReview).toBeTruthy();
    expect(e.getReview).toBeTruthy();
    expect(e.updateReviewStatus).toBeTruthy();
    expect(e.addReviewComment).toBeTruthy();
    expect(e.getMessages).toBeTruthy();
    expect(e.getThreadComments).toBeTruthy();
    expect(e.getReviews).toBeTruthy();
    expect(e.getReviewById).toBeTruthy();
    expect(e.updateCommentVisibility).toBeTruthy();
    expect(e.updateComment).toBeTruthy();
    expect(e.deleteComment).toBeTruthy();
    expect(e.getGeneralReviewComments).toBeTruthy();
  });

  it('exports hooks', () => {
    const m = require('../reviewsApi');
    expect(m.useCreateReviewMutation).toBeDefined();
    expect(m.useGetReviewQuery).toBeDefined();
    expect(m.useUpdateReviewStatusMutation).toBeDefined();
    expect(m.useGetMessagesQuery).toBeDefined();
    expect(m.useLazyGetMessagesQuery).toBeDefined();
    expect(m.useAddReviewCommentMutation).toBeDefined();
    expect(m.useLazyGetThreadCommentsQuery).toBeDefined();
    expect(m.useGetReviewsQuery).toBeDefined();
    expect(m.useLazyGetReviewsQuery).toBeDefined();
    expect(m.useGetReviewByIdQuery).toBeDefined();
    expect(m.useUpdateCommentVisibilityMutation).toBeDefined();
    expect(m.useUpdateCommentMutation).toBeDefined();
    expect(m.useDeleteCommentMutation).toBeDefined();
    expect(m.useLazyGetGeneralReviewCommentsQuery).toBeDefined();
    expect(m.useGetGeneralReviewCommentsQuery).toBeDefined();
  });

  it('createReview POSTs body', async () => {
    const store = createApiTestStore();
    const body = {
      scenarioSessionId: 's1',
      note: 'note',
    } as any;
    await store.dispatch(
      reviewsApi.endpoints.createReview.initiate(body, noTrack),
    );
    const {url, method, body: rawBody} = await getFirstFetchFromMock(
      global.fetch as jest.Mock,
    );
    expect(method).toBe('POST');
    expect(url).toContain('scenario-session-reviews');
    expect(JSON.parse(rawBody!)).toEqual(body);
  });

  it('getReview GETs by reviewId', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.getReview.initiate({reviewId: 'r-1'}, noSubscribe),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/scenario-session-reviews/r-1');
    expect(method).toBe('GET');
  });

  it('updateReviewStatus PATCHes body', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.updateReviewStatus.initiate(
        {reviewId: 'r-2', body: {status: ReviewStatus.IN_REVIEW}},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({status: ReviewStatus.IN_REVIEW});
  });

  it('addReviewComment POSTs thread and content fields', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.addReviewComment.initiate(
        {
          reviewId: 'r-3',
          content: 'c',
          threadId: 't1',
          parentCommentId: 'p1',
          messageId: 'm1',
          selection: {startIndex: 0, endIndex: 1, selectedText: 'x'},
        },
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('POST');
    const b = JSON.parse(body!);
    expect(b.content).toBe('c');
    expect(b.threadId).toBe('t1');
    expect(b.parentCommentId).toBe('p1');
    expect(b.messageId).toBe('m1');
    expect(b.selection).toEqual({
      startIndex: 0,
      endIndex: 1,
      selectedText: 'x',
    });
  });

  it('getMessages GETs with optional sortOrder and sortBy', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.getMessages.initiate(
        {
          reviewId: 'r-4',
          offset: 0,
          limit: 20,
          sortOrder: 'ASC' as any,
          sortBy: 'createdAt',
        },
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('/messages');
    expect(url).toContain('sortOrder=ASC');
    expect(url).toContain('sortBy=createdAt');
  });

  it('getThreadComments GETs without params when offset/limit omitted', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.getThreadComments.initiate(
        {threadId: 'th-1'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('threads/th-1/comments');
    expect(url).not.toContain('offset=');
  });

  it('getThreadComments GETs with offset and limit', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.getThreadComments.initiate(
        {threadId: 'th-2', offset: 5, limit: 10},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=5');
    expect(url).toContain('limit=10');
  });

  it('getReviews GETs with sortBy limit offset and DESC order', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.getReviews.initiate(
        {sortBy: 'createdAt', limit: 10, offset: 0},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('scenario-session-reviews');
    expect(url).toContain(`order=${SortOrder.DESC}`);
    expect(url).toContain('sortBy=createdAt');
  });

  it('getReviewById GETs review', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.getReviewById.initiate(
        {reviewId: 'r-5'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('r-5');
  });

  it('updateCommentVisibility PATCHes hidden', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.updateCommentVisibility.initiate(
        {commentId: 'cm-1', hidden: true},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({hidden: true});
  });

  it('updateComment PATCHes content', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.updateComment.initiate(
        {commentId: 'cm-2', content: 'new'},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({content: 'new'});
  });

  it('deleteComment DELETEs', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.deleteComment.initiate(
        {commentId: 'cm-3'},
        noTrack,
      ),
    );
    const {method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('DELETE');
  });

  it('getGeneralReviewComments GETs without pagination when offset/limit omitted', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.getGeneralReviewComments.initiate(
        {reviewId: 'r-6'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('r-6/comments');
    expect(url).not.toContain('offset=');
  });

  it('getGeneralReviewComments GETs with offset and limit', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      reviewsApi.endpoints.getGeneralReviewComments.initiate(
        {reviewId: 'r-7', offset: 1, limit: 3},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=1');
    expect(url).toContain('limit=3');
  });
});
