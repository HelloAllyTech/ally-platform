import {AnyAction, configureStore} from '@reduxjs/toolkit';

import {api} from '../api';

// Mocks for tokens + store dispatch used by api.ts
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn(async (key: string) => (key.includes('ACCESS') ? 'a' : 'r')),
}));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

describe('api baseQueryWithReauth', () => {
  it('creates api slice without crashing', () => {
    // Simply ensure the API object is defined and has reducerPath
    expect(api.reducerPath).toBe('api');
  });

  it('does not log request/response bodies (bearer tokens, PII) to the console in production', async () => {
    const globalAny = global as unknown as {__DEV__: boolean};
    const originalDev = globalAny.__DEV__;
    globalAny.__DEV__ = false;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const store = configureStore({
        reducer: {[api.reducerPath]: api.reducer},
        middleware: gDM => gDM().concat(api.middleware),
        // autoBatch (on by default) defers subscriber notification to
        // requestAnimationFrame, which react-native's jest setup polyfills as a
        // setTimeout. If one is still queued when the test env tears down, its
        // callback throws "You are trying to access a property or method of the
        // Jest environment after it has been torn down".
        enhancers: getDefaultEnhancers => getDefaultEnhancers({autoBatch: false}),
      });

      const {callsAPI} = require('../callsApi');
      const action = callsAPI.endpoints.getCallLogs.initiate({
        limit: 1,
        offset: 0,
      });
      await store.dispatch(action as unknown as AnyAction);

      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      globalAny.__DEV__ = originalDev;
    }
  });
});

// Mock store used internally by api.ts for token actions
const mockDispatchSpy = jest.fn();
jest.mock('@/store/store', () => ({store: {dispatch: (a: any) => mockDispatchSpy(a)}}));

// Intercept fetchBaseQuery to simulate: 401 -> refresh success -> original success
let mockCallCount = 0;
jest.mock('@reduxjs/toolkit/query/react', () => {
  const actual = jest.requireActual('@reduxjs/toolkit/query/react');
  return {
    ...actual,
    fetchBaseQuery: () => async (args: any) => {
      mockCallCount++;
      if (mockCallCount === 1) {
        return {error: {status: 401}} as any;
      }
      // Second call should be refresh
      if (mockCallCount === 2) {
        if (typeof args === 'object' && args.url) {
          return {data: {accessToken: 'newA', refreshToken: 'newR'}} as any;
        }
      }
      return {data: {ok: true}} as any;
    },
  };
});

describe('api reauth flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dispatches storeTokens on 401 then succeeds original request', async () => {
    mockCallCount = 0;
    const {api: apiReauth} = require('../api');
    const {callsAPI} = require('../callsApi');

    const store = configureStore({
      reducer: {[apiReauth.reducerPath]: apiReauth.reducer},
      middleware: gDM => gDM().concat(apiReauth.middleware),
      // See the autoBatch note in the store above.
      enhancers: getDefaultEnhancers => getDefaultEnhancers({autoBatch: false}),
    });

    const action = callsAPI.endpoints.getCallLogs.initiate({limit: 1, offset: 0});
    await store.dispatch(action as unknown as AnyAction);

    expect(mockDispatchSpy).toHaveBeenCalledWith({
      type: 'storeTokens',
      payload: {accessToken: 'newA', refreshToken: 'newR'},
    });
    // final call returns ok:true
    expect(mockCallCount).toBeGreaterThanOrEqual(3);
  });
});
