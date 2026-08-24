import {AnyAction, configureStore} from '@reduxjs/toolkit';

// Capture the args fetchBaseQuery receives so we can assert languageCode injection.
const capturedArgs: any[] = [];

jest.mock('@/store/store', () => ({store: {dispatch: jest.fn()}}));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({type: 'logout'}),
  storeTokens: (p: any) => ({type: 'storeTokens', payload: p}),
}));
jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn(async () => 'token'),
}));
jest.mock('@/utils/logger', () => ({logger: {error: jest.fn()}}));
jest.mock('@/config/env', () => ({
  env: {API_BASE_URL: 'https://example.com', API_VERSION: 'v1'},
}));
jest.mock('@/localization/i18n', () => ({
  __esModule: true,
  default: {resolvedLanguage: 'hi', language: 'hi'},
}));

jest.mock('@reduxjs/toolkit/query/react', () => {
  const actual = jest.requireActual('@reduxjs/toolkit/query/react');
  return {
    ...actual,
    fetchBaseQuery: () => async (args: any) => {
      capturedArgs.push(args);
      return {data: []} as any;
    },
  };
});

const buildStore = () => {
  const {api} = require('../api');
  const store = configureStore({
    reducer: {[api.reducerPath]: api.reducer},
    middleware: gDM => gDM().concat(api.middleware),
    // autoBatch (on by default) defers subscriber notification to
    // requestAnimationFrame, which react-native's jest setup polyfills as a
    // setTimeout. If one is still queued when the test env tears down, its
    // callback throws "You are trying to access a property or method of the
    // Jest environment after it has been torn down".
    enhancers: getDefaultEnhancers => getDefaultEnhancers({autoBatch: false}),
  });
  return {api, store};
};

describe('languageCode injection in baseQuery', () => {
  beforeEach(() => {
    capturedArgs.length = 0;
  });

  it('injects languageCode into params for an allowlisted GET endpoint', async () => {
    const {store} = buildStore();
    const {simulationsApi} = require('../simulationsApi');

    await store.dispatch(
      simulationsApi.endpoints.getScenarios.initiate() as unknown as AnyAction,
    );

    const args = capturedArgs.find(a => String(a.url).includes('scenario'));
    expect(args).toBeDefined();
    expect(args.params).toMatchObject({languageCode: 'hi'});
  });

  it('does NOT inject languageCode into a non-allowlisted endpoint', async () => {
    const {store} = buildStore();
    const {callsAPI} = require('../callsApi');

    await store.dispatch(
      callsAPI.endpoints.getCallLogs.initiate({
        limit: 1,
        offset: 0,
      }) as unknown as AnyAction,
    );

    capturedArgs.forEach(a => {
      expect(a?.params?.languageCode).toBeUndefined();
    });
  });
});
