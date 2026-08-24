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

import {scribeGeneralCommentsApi} from '../scribeGeneralCommentsApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() =>
    Promise.resolve(mockOkJsonResponse({data: [], count: 0})),
  );
};

const noSubscribe = {subscribe: false} as const;
const noTrack = {track: false} as const;

describe('scribeGeneralCommentsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes all endpoints', () => {
    const e = (scribeGeneralCommentsApi as any).endpoints;
    expect(e.getScribeGeneralComments).toBeTruthy();
    expect(e.getScribeGeneralCommentsOverview).toBeTruthy();
    expect(e.addScribeGeneralComment).toBeTruthy();
    expect(e.deleteScribeGeneralComment).toBeTruthy();
    expect(e.updateScribeGeneralComment).toBeTruthy();
    expect(e.updateScribeGeneralCommentVisibility).toBeTruthy();
  });

  it('exports hooks', () => {
    const {
      useLazyGetScribeGeneralCommentsQuery,
      useLazyGetScribeGeneralCommentsOverviewQuery,
      useAddScribeGeneralCommentMutation,
      useDeleteScribeGeneralCommentMutation,
      useUpdateScribeGeneralCommentMutation,
      useUpdateScribeGeneralCommentVisibilityMutation,
    } = require('../scribeGeneralCommentsApi');
    expect(useLazyGetScribeGeneralCommentsQuery).toBeDefined();
    expect(useLazyGetScribeGeneralCommentsOverviewQuery).toBeDefined();
    expect(useAddScribeGeneralCommentMutation).toBeDefined();
    expect(useDeleteScribeGeneralCommentMutation).toBeDefined();
    expect(useUpdateScribeGeneralCommentMutation).toBeDefined();
    expect(useUpdateScribeGeneralCommentVisibilityMutation).toBeDefined();
  });

  it('getScribeGeneralComments uses scribe-session-reviews path', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeGeneralCommentsApi.endpoints.getScribeGeneralComments.initiate(
        {reviewId: 'sr-1'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/scribe-session-reviews/sr-1/general-comments');
  });

  it('getScribeGeneralCommentsOverview uses scribe comments-overview', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeGeneralCommentsApi.endpoints.getScribeGeneralCommentsOverview.initiate(
        {reviewId: 'sr-2'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('scribe-session-reviews/sr-2/comments-overview');
  });

  it('addScribeGeneralComment POSTs to scribe general-comments', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeGeneralCommentsApi.endpoints.addScribeGeneralComment.initiate(
        {reviewId: 'sr-3', content: 'Note'},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('POST');
    expect(JSON.parse(body!)).toEqual({content: 'Note'});
  });

  it('deleteScribeGeneralComment DELETEs scribe general-comment', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeGeneralCommentsApi.endpoints.deleteScribeGeneralComment.initiate(
        {commentId: 'sc-1'},
        noTrack,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('scribe-session-reviews/general-comments/sc-1');
    expect(method).toBe('DELETE');
  });

  it('updateScribeGeneralComment PATCHes scribe general-comment', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeGeneralCommentsApi.endpoints.updateScribeGeneralComment.initiate(
        {commentId: 'sc-2', content: 'Edit'},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({content: 'Edit'});
  });

  it('updateScribeGeneralCommentVisibility PATCHes visibility', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      scribeGeneralCommentsApi.endpoints.updateScribeGeneralCommentVisibility.initiate(
        {commentId: 'sc-3', hidden: false},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({hidden: false});
  });
});
