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
    const e = (settingsApi as any).endpoints;
    expect(e.getVisibleChatTypes).toBeTruthy();
    expect(e.getSummaryFields).toBeTruthy();
  });

  it('exports hooks', () => {
    const {useLazyGetVisibleChatTypesQuery, useLazyGetSummaryFieldsQuery} = require('../settingsApi');
    expect(useLazyGetVisibleChatTypesQuery).toBeDefined();
    expect(useLazyGetSummaryFieldsQuery).toBeDefined();
  });

  it('getVisibleChatTypes endpoint is defined', () => {
    const endpoint = (settingsApi as any).endpoints.getVisibleChatTypes;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('getSummaryFields endpoint is defined', () => {
    const endpoint = (settingsApi as any).endpoints.getSummaryFields;
    expect(endpoint.matchFulfilled).toBeDefined();
  });
});
