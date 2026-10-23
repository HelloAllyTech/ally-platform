// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {searchApi} from '../searchApi';

describe('searchApi', () => {
  it('exposes search endpoints', () => {
    const e = (searchApi as any).endpoints;
    expect(e.getSearchResults).toBeTruthy();
  });

  it('exports hooks', () => {
    const {useLazyGetSearchResultsQuery} = require('../searchApi');
    expect(useLazyGetSearchResultsQuery).toBeDefined();
  });

  it('getSearchResults endpoint is defined', () => {
    const endpoint = (searchApi as any).endpoints.getSearchResults;
    expect(endpoint.matchFulfilled).toBeDefined();
  });
});
