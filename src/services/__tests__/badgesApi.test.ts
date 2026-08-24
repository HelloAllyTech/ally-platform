jest.mock('@/store/store', () => ({
  store: {dispatch: jest.fn(), getState: jest.fn(() => ({}))},
}));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({type: 'logout'}),
  storeTokens: (p: unknown) => ({type: 'storeTokens', payload: p}),
}));
jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn(async () => undefined),
}));
jest.mock('@/config/env', () => ({
  env: {API_BASE_URL: 'https://example.com', API_VERSION: 'v1'},
}));

import {ViewedStatus} from '@/constants/badges';

import {badgesApi} from '../badgesApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() => Promise.resolve(mockOkJsonResponse({})));
};

const noSubscribe = {subscribe: false} as const;
const noTrack = {track: false} as const;

describe('badgesApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes all endpoints', () => {
    const e = (badgesApi as any).endpoints;
    expect(e.getAvailableBadges).toBeTruthy();
    expect(e.getBadges).toBeTruthy();
    expect(e.getBadgeCount).toBeTruthy();
    expect(e.markBadgeAsViewed).toBeTruthy();
  });

  it('exports hooks', () => {
    const {
      useGetAvailableBadgesQuery,
      useGetBadgesQuery,
      useGetBadgeCountQuery,
      useMarkBadgeAsViewedMutation,
    } = require('../badgesApi');
    expect(useGetAvailableBadgesQuery).toBeDefined();
    expect(useGetBadgesQuery).toBeDefined();
    expect(useGetBadgeCountQuery).toBeDefined();
    expect(useMarkBadgeAsViewedMutation).toBeDefined();
  });

  it('getAvailableBadges GETs /badges/me/available', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      badgesApi.endpoints.getAvailableBadges.initiate(undefined, noSubscribe),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/badges/me/available');
    expect(method).toBe('GET');
  });

  it('getBadges GETs with viewedStatus param', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      badgesApi.endpoints.getBadges.initiate(
        {viewedStatus: ViewedStatus.UNVIEWED},
        noSubscribe,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/badges/me');
    expect(url).toContain('viewedStatus=UNVIEWED');
    expect(method).toBe('GET');
  });

  it('getBadgeCount GETs count with viewedStatus', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      badgesApi.endpoints.getBadgeCount.initiate(
        {viewedStatus: ViewedStatus.VIEWED},
        noSubscribe,
      ),
    );
    const {url} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(url).toContain('v1/badges/me/count');
    expect(url).toContain('viewedStatus=VIEWED');
  });

  it('markBadgeAsViewed PATCHes badge viewed route', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      badgesApi.endpoints.markBadgeAsViewed.initiate('badge-xyz', noTrack),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('PATCH');
    expect(url).toContain('badge-xyz');
    expect(url).toContain('viewed');
  });
});
