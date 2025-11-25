// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {analyticsApi} from '../analyticsApi';

describe('analyticsApi', () => {
  it('exposes analytics endpoints', () => {
    const e = (analyticsApi as any).endpoints;
    expect(e.getDashboards).toBeTruthy();
    expect(e.getDashboardUrl).toBeTruthy();
  });

  it('exports hooks', () => {
    const {useGetDashboardsQuery, useLazyGetDashboardUrlQuery} = require('../analyticsApi');
    expect(useGetDashboardsQuery).toBeDefined();
    expect(useLazyGetDashboardUrlQuery).toBeDefined();
  });

  it('getDashboards endpoint is defined', () => {
    const endpoint = (analyticsApi as any).endpoints.getDashboards;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('getDashboardUrl endpoint is defined', () => {
    const endpoint = (analyticsApi as any).endpoints.getDashboardUrl;
    expect(endpoint.matchFulfilled).toBeDefined();
  });
});

