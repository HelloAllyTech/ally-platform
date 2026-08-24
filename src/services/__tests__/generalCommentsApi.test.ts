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

import {generalCommentsApi} from '../generalCommentsApi';
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

describe('generalCommentsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes all endpoints', () => {
    const e = (generalCommentsApi as any).endpoints;
    expect(e.getGeneralComments).toBeTruthy();
    expect(e.getGeneralCommentsOverview).toBeTruthy();
    expect(e.addGeneralComment).toBeTruthy();
    expect(e.deleteGeneralComment).toBeTruthy();
    expect(e.updateGeneralComment).toBeTruthy();
    expect(e.updateGeneralCommentVisibility).toBeTruthy();
  });

  it('exports hooks', () => {
    const {
      useLazyGetGeneralCommentsQuery,
      useLazyGetGeneralCommentsOverviewQuery,
      useAddGeneralCommentMutation,
      useDeleteGeneralCommentMutation,
      useUpdateGeneralCommentMutation,
      useUpdateGeneralCommentVisibilityMutation,
    } = require('../generalCommentsApi');
    expect(useLazyGetGeneralCommentsQuery).toBeDefined();
    expect(useLazyGetGeneralCommentsOverviewQuery).toBeDefined();
    expect(useAddGeneralCommentMutation).toBeDefined();
    expect(useDeleteGeneralCommentMutation).toBeDefined();
    expect(useUpdateGeneralCommentMutation).toBeDefined();
    expect(useUpdateGeneralCommentVisibilityMutation).toBeDefined();
  });

  it('getGeneralComments GETs without params when offset/limit omitted', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      generalCommentsApi.endpoints.getGeneralComments.initiate(
        {reviewId: 'rev-1'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/scenario-session-reviews/rev-1/general-comments');
    expect(url).not.toContain('offset=');
  });

  it('getGeneralComments GETs with offset and limit when both provided', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      generalCommentsApi.endpoints.getGeneralComments.initiate(
        {reviewId: 'rev-2', offset: 10, limit: 5},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('offset=10');
    expect(url).toContain('limit=5');
  });

  it('getGeneralCommentsOverview GETs with default sort params', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      generalCommentsApi.endpoints.getGeneralCommentsOverview.initiate(
        {reviewId: 'rev-3'},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('comments-overview');
    expect(url).toContain('sortOrder=DESC');
    expect(url).toContain('sortBy=createdAt');
    expect(url).toContain('offset=0');
    expect(url).toContain('limit=2');
  });

  it('addGeneralComment POSTs content', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      generalCommentsApi.endpoints.addGeneralComment.initiate(
        {reviewId: 'rev-4', content: 'Hello'},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('POST');
    expect(JSON.parse(body!)).toEqual({content: 'Hello'});
  });

  it('deleteGeneralComment DELETEs by comment id', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      generalCommentsApi.endpoints.deleteGeneralComment.initiate(
        {commentId: 'c-99'},
        noTrack,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('DELETE');
    expect(url).toContain('c-99');
  });

  it('updateGeneralComment PATCHes content', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      generalCommentsApi.endpoints.updateGeneralComment.initiate(
        {commentId: 'c-1', content: 'Updated'},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({content: 'Updated'});
  });

  it('updateGeneralCommentVisibility PATCHes hidden', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      generalCommentsApi.endpoints.updateGeneralCommentVisibility.initiate(
        {commentId: 'c-2', hidden: true},
        noTrack,
      ),
    );
    const {method, body} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({hidden: true});
  });
});
