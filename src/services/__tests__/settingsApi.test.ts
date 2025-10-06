// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {settingsApi} from '../settingsApi';

describe('settingsApi', () => {
  it('exposes settings endpoints', () => {
    const endpoints = (settingsApi as any).endpoints;
    expect(endpoints.getSummaryFields).toBeTruthy();
    expect(endpoints.getNudgeStatus).toBeTruthy();
    expect(endpoints.getVisibleChatTypes).toBeTruthy();
  });
});


