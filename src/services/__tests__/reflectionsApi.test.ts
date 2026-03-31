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
import {reflectionsApi} from '../reflectionsApi';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() =>
    Promise.resolve(mockOkJsonResponse({reflectionPrompts: []})),
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
const noTrack = {track: false} as const;

describe('reflectionsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes endpoints', () => {
    const e = (reflectionsApi as any).endpoints;
    expect(e.getReflectionPrompts).toBeTruthy();
    expect(e.updateReflectionPrompt).toBeTruthy();
  });

  it('exports hooks', () => {
    const {useGetReflectionPromptsQuery, useUpdateReflectionPromptMutation} =
      require('../reflectionsApi');
    expect(useGetReflectionPromptsQuery).toBeDefined();
    expect(useUpdateReflectionPromptMutation).toBeDefined();
  });

  it('getReflectionPrompts GETs reflection-prompts for session', async () => {
    const store = createTestStore();
    await store.dispatch(
      reflectionsApi.endpoints.getReflectionPrompts.initiate(
        {scenarioSessionId: 'sess-abc'},
        noSubscribe,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/learn/scenario-session/sess-abc/reflection-prompts');
    expect(method).toBe('GET');
  });

  it('updateReflectionPrompt PATCHes prompt by id', async () => {
    const store = createTestStore();
    await store.dispatch(
      reflectionsApi.endpoints.updateReflectionPrompt.initiate(
        {
          scenarioSessionId: 'sess-1',
          reflectionPromptId: 'rp-1',
          body: {promptId: 'p1', response: 'My answer'},
        },
        noTrack,
      ),
    );
    const {url, method, body} = await getFirstFetchFromMock(
      global.fetch as jest.Mock,
    );
    expect(url).toContain('sess-1');
    expect(url).toContain('rp-1');
    expect(method).toBe('PATCH');
    expect(JSON.parse(body!)).toEqual({
      promptId: 'p1',
      response: 'My answer',
    });
  });
});
