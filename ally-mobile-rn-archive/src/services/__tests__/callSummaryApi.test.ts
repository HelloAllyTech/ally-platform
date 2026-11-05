// Mock modules used by api.ts to avoid importing the real Redux store
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {callSummaryApi} from '../callSummaryApi';

describe('callSummaryApi', () => {
  it('exposes expected endpoints', () => {
    const endpoints = (callSummaryApi as any).endpoints;
    expect(endpoints.getCallSummary).toBeTruthy();
    expect(endpoints.updateCallSummary).toBeTruthy();
    expect(endpoints.exportCallSummary).toBeTruthy();
    expect(endpoints.updateCallInfo).toBeTruthy();
    expect(endpoints.enhanceCallSummary).toBeTruthy();
    expect(endpoints.getTags).toBeTruthy();
  });
});


