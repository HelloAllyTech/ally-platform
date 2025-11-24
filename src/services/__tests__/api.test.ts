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
  it('dispatches storeTokens on 401 then succeeds original request', async () => {
    mockCallCount = 0;
    const {api: apiReauth} = require('../api');
    const {callsAPI} = require('../callsApi');

    const store = configureStore({
      reducer: {[apiReauth.reducerPath]: apiReauth.reducer},
      middleware: gDM => gDM().concat(apiReauth.middleware),
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


