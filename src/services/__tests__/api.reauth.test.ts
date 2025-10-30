import {AnyAction, configureStore} from '@reduxjs/toolkit';

// Mock store used internally by api.ts for token actions
const mockDispatchSpy = jest.fn();
jest.mock('@/store/store', () => ({store: {dispatch: (a: any) => mockDispatchSpy(a)}}));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({type: 'logout'}),
  storeTokens: (p: any) => ({type: 'storeTokens', payload: p}),
}));
jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn(async (key: string) => (key.includes('ACCESS') ? 'oldAccess' : 'oldRefresh')),
}));
jest.mock('@/config/env', () => ({env: {API_BASE_URL: 'https://example.com', API_VERSION: 'v1'}}));

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
    const {api} = require('../api');
    const {callsAPI} = require('../callsApi');

    const store = configureStore({
      reducer: {[api.reducerPath]: api.reducer},
      middleware: gDM => gDM().concat(api.middleware),
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


