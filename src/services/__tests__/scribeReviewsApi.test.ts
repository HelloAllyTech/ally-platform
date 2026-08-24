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

import {scribeReviewsApi} from '../scribeReviewsApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() => Promise.resolve(mockOkJsonResponse({})));
};

const noSubscribe = {subscribe: false} as const;
const noTrack = {track: false} as const;

describe('scribeReviewsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes all endpoints', () => {
    const e = (scribeReviewsApi as any).endpoints;
    expect(e.getScribeReviews).toBeTruthy();
    expect(e.createScribeReview).toBeTruthy();
    expect(e.updateScribeReviewStatus).toBeTruthy();
    expect(e.getScribeReviewById).toBeTruthy();
    expect(e.getScribeMessages).toBeTruthy();
    expect(e.addScribeReviewComment).toBeTruthy();
    expect(e.getScribeThreadComments).toBeTruthy();
    expect(e.updateScribeCommentVisibility).toBeTruthy();
    expect(e.updateScribeComment).toBeTruthy();
    expect(e.deleteScribeComment).toBeTruthy();
    expect(e.getScribeGeneralReviewComments).toBeTruthy();
  });

  it('exports hooks', () => {
    const m = require('../scribeReviewsApi');
    expect(m.useGetScribeReviewsQuery).toBeDefined();
    expect(m.useLazyGetScribeReviewsQuery).toBeDefined();
    expect(m.useCreateScribeReviewMutation).toBeDefined();
    expect(m.useUpdateScribeReviewStatusMutation).toBeDefined();
    expect(m.useGetScribeReviewByIdQuery).toBeDefined();
    expect(m.useLazyGetScribeMessagesQuery).toBeDefined();
    expect(m.useAddScribeReviewCommentMutation).toBeDefined();
    expect(m.useLazyGetScribeThreadCommentsQuery).toBeDefined();
    expect(m.useUpdateScribeCommentVisibilityMutation).toBeDefined();
    expect(m.useUpdateScribeCommentMutation).toBeDefined();
    expect(m.useDeleteScribeCommentMutation).toBeDefined();
    expect(m.useLazyGetScribeGeneralReviewCommentsQuery).toBeDefined();
    expect(m.useGetScribeGeneralReviewCommentsQuery).toBeDefined();
  });

  it('getScribeReviews GETs with order DESC and list params', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.getScribeReviews.initiate(
        {sortBy: 'createdAt', limit: 5, offset: 0},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/scribe-session-reviews');
    expect(url).toContain(`order=${SortOrder.DESC}`);
    expect(url).toContain('sortBy=createdAt');
    expect(url).toContain('limit=5');
    expect(url).toContain('offset=0');
  });

  it('createScribeReview POSTs scribeSessionId and note', async () => {
    const store = createApiTestStore();
    const body = {scribeSessionId: 99, note: 'hello'};
    await store.dispatch(
      scribeReviewsApi.endpoints.createScribeReview.initiate(body, noTrack),
    );
    const {url, method, body: raw} = await getFirstFetchFromMock(
      global.fetch as jest.Mock,
    );
    expect(method).toBe('POST');
    expect(url).toContain('scribe-session-reviews');
    expect(JSON.parse(raw!)).toEqual(body);
  });

  it('updateScribeReviewStatus PATCHes status body', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.updateScribeReviewStatus.initiate(
        {reviewId: 'r-1', body: {status: ReviewStatus.IN_REVIEW}},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({status: ReviewStatus.IN_REVIEW});
  });

  it('getScribeReviewById GETs by id', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.getScribeReviewById.initiate(
        {reviewId: 'r-2'},
        noSubscribe,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('GET');
    expect(url).toContain('v1/scribe-session-reviews/r-2');
  });

  it('getScribeMessages GETs with optional sort params', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.getScribeMessages.initiate(
        {
          reviewId: 'r-3',
          offset: 0,
          limit: 10,
          sortOrder: 'DESC' as any,
          sortBy: 'createdAt',
        },
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('r-3/messages');
    expect(url).toContain('sortOrder=DESC');
    expect(url).toContain('sortBy=createdAt');
  });

  it('addScribeReviewComment POSTs thread fields', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.addScribeReviewComment.initiate(
        {
          reviewId: 'r-4',
          content: 'x',
          threadId: 't1',
          parentCommentId: 'p1',
          messageId: 'm1',
          selection: {startIndex: 0, endIndex: 1, selectedText: 'hi'},
        },
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('POST');
    const b = JSON.parse(body!);
    expect(b.content).toBe('x');
    expect(b.threadId).toBe('t1');
    expect(b.parentCommentId).toBe('p1');
    expect(b.messageId).toBe('m1');
    expect(b.selection).toEqual({
      startIndex: 0,
      endIndex: 1,
      selectedText: 'hi',
    });
  });

  it('getScribeThreadComments GETs without pagination when omitted', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.getScribeThreadComments.initiate(
        {threadId: 'th-1'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('scribe-session-reviews/threads/th-1/comments');
    expect(url).not.toContain('offset=');
  });

  it('getScribeThreadComments GETs with offset and limit', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.getScribeThreadComments.initiate(
        {threadId: 'th-2', offset: 4, limit: 8},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=4');
    expect(url).toContain('limit=8');
  });

  it('updateScribeCommentVisibility PATCHes hidden', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.updateScribeCommentVisibility.initiate(
        {commentId: 'cm-1', hidden: true},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({hidden: true});
  });

  it('updateScribeComment PATCHes content', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.updateScribeComment.initiate(
        {commentId: 'cm-2', content: 'edited'},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({content: 'edited'});
  });

  it('deleteScribeComment DELETEs', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.deleteScribeComment.initiate(
        {commentId: 'cm-3'},
        noTrack,
      ),
    );
    const {method, url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('DELETE');
    expect(url).toContain('cm-3');
  });

  it('getScribeGeneralReviewComments GETs without pagination when omitted', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.getScribeGeneralReviewComments.initiate(
        {reviewId: 'r-5'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('scribe-session-reviews/r-5/comments');
    expect(url).not.toContain('offset=');
  });

  it('getScribeGeneralReviewComments GETs with offset and limit', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeReviewsApi.endpoints.getScribeGeneralReviewComments.initiate(
        {reviewId: 'r-6', offset: 2, limit: 3},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=2');
    expect(url).toContain('limit=3');
  });
});
