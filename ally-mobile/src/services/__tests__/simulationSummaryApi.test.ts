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

import {simulationSummaryApi} from '../simulationSummaryApi';
import {createApiTestStore} from '../testUtils/createApiTestStore';
import {getFirstFetchFromMock} from '../testUtils/getFirstFetchFromMock';
import {mockOkJsonResponse} from '../testUtils/mockOkJsonResponse';

const setupFetchMock = () => {
  global.fetch = jest.fn(() => Promise.resolve(mockOkJsonResponse({skills: []})));
};

const noSubscribe = {subscribe: false} as const;

describe('simulationSummaryApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetchMock();
  });

  it('exposes endpoints', () => {
    const e = (simulationSummaryApi as any).endpoints;
    expect(e.getSimulationSkills).toBeTruthy();
    expect(e.getChatHistory).toBeTruthy();
  });

  it('exports hooks', () => {
    const {useGetSimulationSkillsQuery, useLazyGetChatHistoryQuery} =
      require('../simulationSummaryApi');
    expect(useGetSimulationSkillsQuery).toBeDefined();
    expect(useLazyGetChatHistoryQuery).toBeDefined();
  });

  it('getSimulationSkills GETs scenario session skills', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      simulationSummaryApi.endpoints.getSimulationSkills.initiate(
        {scenarioSessionId: 'sess-xyz'},
        noSubscribe,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('GET');
    expect(url).toContain(
      'v1/learn/scenario-session/sess-xyz/skills',
    );
  });

  it('getChatHistory GETs chat history for session', async () => {
    const store = createApiTestStore();
    await store.dispatch(
      simulationSummaryApi.endpoints.getChatHistory.initiate(
        'session-abc',
        noSubscribe,
      ),
    );
    const {url, method} = await getFirstFetchFromMock(global.fetch as jest.Mock);
    expect(method).toBe('GET');
    expect(url).toContain(
      'v1/learn/scenario-sessions/session-abc/chat/history',
    );
  });
});
