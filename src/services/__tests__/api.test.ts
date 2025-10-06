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


