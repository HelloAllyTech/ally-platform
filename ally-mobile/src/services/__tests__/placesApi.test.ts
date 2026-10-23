// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {placesApi} from '../placesApi';

describe('placesApi', () => {
  it('exposes places endpoints', () => {
    const e = (placesApi as any).endpoints;
    expect(e.getPlaces).toBeTruthy();
    expect(e.searchPlaces).toBeTruthy();
  });

  it('exports hooks', () => {
    const {useGetPlacesQuery, useLazySearchPlacesQuery} = require('../placesApi');
    expect(useGetPlacesQuery).toBeDefined();
    expect(useLazySearchPlacesQuery).toBeDefined();
  });

  it('getPlaces endpoint is defined', () => {
    const endpoint = (placesApi as any).endpoints.getPlaces;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('searchPlaces endpoint is defined', () => {
    const endpoint = (placesApi as any).endpoints.searchPlaces;
    expect(endpoint.matchFulfilled).toBeDefined();
  });
});
