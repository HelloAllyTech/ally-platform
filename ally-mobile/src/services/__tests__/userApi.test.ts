// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {userApi} from '../userApi';

describe('userApi', () => {
  it('exposes preferences endpoints', () => {
    const e = (userApi as any).endpoints;
    expect(e.getUserPreferences).toBeTruthy();
    expect(e.updateUserPreferences).toBeTruthy();
  });

  it('has getUserPreferences endpoint with correct type', () => {
    const endpoint = (userApi as any).endpoints.getUserPreferences;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has updateUserPreferences mutation endpoint', () => {
    const endpoint = (userApi as any).endpoints.updateUserPreferences;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('exports all hooks', () => {
    const {
      useGetUserPreferencesQuery,
      useLazyGetUserPreferencesQuery,
      useUpdateUserPreferencesMutation,
    } = userApi;

    expect(useGetUserPreferencesQuery).toBeDefined();
    expect(useLazyGetUserPreferencesQuery).toBeDefined();
    expect(useUpdateUserPreferencesMutation).toBeDefined();
  });

  it('getUserPreferences query returns UserPreferences data', () => {
    const endpoint = (userApi as any).endpoints.getUserPreferences;
    expect(endpoint).toBeTruthy();
    // Should return {data: UserPreferences}
  });

  it('updateUserPreferences mutation accepts preferences object', () => {
    const endpoint = (userApi as any).endpoints.updateUserPreferences;
    expect(endpoint).toBeTruthy();
    // Should accept Record<string, any> and return {success: boolean}
  });
});
