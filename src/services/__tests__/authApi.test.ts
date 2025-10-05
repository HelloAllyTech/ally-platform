// Mock modules used by api.ts to avoid importing the real Redux store
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {authApi} from '../authApi';

describe('authApi endpoints', () => {
  it('defines generateOtp and verifyOtp endpoints', () => {
    // The injected endpoints decorate api endpoints internally
    expect(typeof (authApi as any).endpoints.generateOtp).toBe('object');
    expect(typeof (authApi as any).endpoints.verifyOtp).toBe('object');
  });
});


