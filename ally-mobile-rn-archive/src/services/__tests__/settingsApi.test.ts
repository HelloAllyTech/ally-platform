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

import {SUMMARY_FIELDS} from '@/constants/summary';
import summaryReducer from '@/store/slices/summarySlice';

import {settingsApi} from '../settingsApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() => Promise.resolve(mockOkJsonResponse([])));
};

const createTestStore = () => createApiTestStore({summary: summaryReducer});

const noSubscribe = {subscribe: false} as const;

describe('settingsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes settings endpoints', () => {
    const e = (settingsApi as any).endpoints;
    expect(e.getSummaryFields).toBeTruthy();
    expect(e.getNudgeStatus).toBeTruthy();
    expect(e.getVisibleChatTypes).toBeTruthy();
  });

  it('exports hooks', () => {
    const {
      useGetSummaryFieldsQuery,
      useLazyGetSummaryFieldsQuery,
      useGetNudgeStatusQuery,
      useLazyGetVisibleChatTypesQuery,
    } = require('../settingsApi');
    expect(useGetSummaryFieldsQuery).toBeDefined();
    expect(useLazyGetSummaryFieldsQuery).toBeDefined();
    expect(useGetNudgeStatusQuery).toBeDefined();
    expect(useLazyGetVisibleChatTypesQuery).toBeDefined();
  });

  it('getSummaryFields GETs summary-fields path', async () => {
    const store = createTestStore();
    await store.dispatch(
      settingsApi.endpoints.getSummaryFields.initiate(undefined, noSubscribe),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('GET');
    expect(url).toContain('v1/settings/summary-fields');
  });

  it('getSummaryFields updates summary.visibleFields when response is array', async () => {
    const fields = [SUMMARY_FIELDS.SESSION_SUMMARY, SUMMARY_FIELDS.ADDITIONAL_NOTES];
    global.fetch = jest.fn(() =>
      Promise.resolve(mockOkJsonResponse(fields)),
    );
    const store = createTestStore();
    await store.dispatch(
      settingsApi.endpoints.getSummaryFields.initiate(undefined, noSubscribe),
    );
    expect(store.getState().summary.visibleFields).toEqual(fields);
  });

  it('getSummaryFields does not update visibleFields when response is not an array', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(mockOkJsonResponse({notAnArray: true})),
    );
    const store = createTestStore();
    await store.dispatch(
      settingsApi.endpoints.getSummaryFields.initiate(undefined, noSubscribe),
    );
    expect(store.getState().summary.visibleFields).toEqual([]);
  });

  it('getNudgeStatus GETs nudge-status', async () => {
    const store = createTestStore();
    await store.dispatch(
      settingsApi.endpoints.getNudgeStatus.initiate(undefined, noSubscribe),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/settings/nudge-status');
  });

  it('getVisibleChatTypes GETs chat-types', async () => {
    const store = createTestStore();
    await store.dispatch(
      settingsApi.endpoints.getVisibleChatTypes.initiate(undefined, noSubscribe),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/settings/chat-types');
  });
});
