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

import {bugReportApi} from '../bugReportApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() =>
    Promise.resolve(mockOkJsonResponse({id: 'bug-1', stage: 'new'})),
  );
};

const noTrack = {track: false} as const;

describe('bugReportApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes the createBugReport endpoint', () => {
    const e = (bugReportApi as any).endpoints;
    expect(e.createBugReport).toBeTruthy();
  });

  it('exports the mutation hook', () => {
    const {useCreateBugReportMutation} = require('../bugReportApi');
    expect(useCreateBugReportMutation).toBeDefined();
  });

  it('POSTs the description and context to /product-roadmap/bug-reports', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      bugReportApi.endpoints.createBugReport.initiate(
        {
          description: 'The app crashed when I started a call',
          context: {
            screen: 'CallLog',
            appVersion: '1.5.0',
            device: 'Google Pixel 7',
            os: 'Android 14',
            clientTimestamp: '2026-08-18T00:00:00.000Z',
          },
        },
        noTrack,
      ),
    );

    const {url, method, body} = await getFirstFetchFromMock(
      global.fetch as jest.Mock,
    );
    expect(url).toContain('v1/product-roadmap/bug-reports');
    expect(method).toBe('POST');
    expect(JSON.parse(body!)).toEqual({
      description: 'The app crashed when I started a call',
      context: {
        screen: 'CallLog',
        appVersion: '1.5.0',
        device: 'Google Pixel 7',
        os: 'Android 14',
        clientTimestamp: '2026-08-18T00:00:00.000Z',
      },
    });
  });
});
