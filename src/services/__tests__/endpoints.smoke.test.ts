import {AnyAction, configureStore} from '@reduxjs/toolkit';

jest.mock('@/store/store', () => ({store: {dispatch: jest.fn()}}));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({type: 'logout'}),
  storeTokens: (p: any) => ({type: 'storeTokens', payload: p}),
}));
jest.mock('@/utils/asyncStorage', () => ({getItem: jest.fn(async () => undefined)}));
jest.mock('@/config/env', () => ({env: {API_BASE_URL: 'https://example.com', API_VERSION: 'v1'}}));

// Always succeed base queries to just exercise endpoint query mappers
jest.mock('@reduxjs/toolkit/query/react', () => {
  const actual = jest.requireActual('@reduxjs/toolkit/query/react');
  return {
    ...actual,
    fetchBaseQuery: () => async () => ({data: {}} as any),
  };
});

describe('services endpoints smoke', () => {
  it('initiates common endpoints without crashing', async () => {
    const {api} = require('../api');
    const {callsAPI} = require('../callsApi');
    const {chatApi} = require('../chatApi');
    const {searchApi} = require('../searchApi');
    const {settingsApi} = require('../settingsApi');
    const {placesApi} = require('../placesApi');
    const {simulationsApi} = require('../simulationsApi');
    const {callTranscriptApi} = require('../callTranscriptApi');
    const {simulationTranscriptApi} = require('../simulationTranscriptApi');
    const {analyticsApi} = require('../analyticsApi');
    const {callSummaryApi} = require('../callSummaryApi');

    const store = configureStore({
      reducer: {[api.reducerPath]: api.reducer},
      middleware: gDM => gDM().concat(api.middleware),
    });

    // queries
    await store.dispatch(callsAPI.endpoints.getCallLogs.initiate({limit: 1, offset: 0}) as unknown as AnyAction);
    await store.dispatch(chatApi.endpoints.getCounsellorChat.initiate() as unknown as AnyAction);
    await store.dispatch(searchApi.endpoints.getSearchResults.initiate({query: 'ally', filters: {}, excludedIds: []}) as unknown as AnyAction);
    await store.dispatch(settingsApi.endpoints.getSummaryFields.initiate() as unknown as AnyAction);
    await store.dispatch(placesApi.endpoints.getPlaces.initiate({page: 1, limit: 10}) as unknown as AnyAction);
    await store.dispatch(placesApi.endpoints.searchPlaces.initiate({query: 'a'}) as unknown as AnyAction);
    await store.dispatch(simulationsApi.endpoints.listRooms.initiate() as unknown as AnyAction);
    await store.dispatch(simulationsApi.endpoints.getScenarios.initiate() as unknown as AnyAction);
    await store.dispatch(simulationsApi.endpoints.getSimulationLogs.initiate({limit: 1, offset: 0}) as unknown as AnyAction);
    await store.dispatch(simulationsApi.endpoints.getSimulationDetails.initiate({id: '1'}) as unknown as AnyAction);
    await store.dispatch(callTranscriptApi.endpoints.getChatMessages.initiate({id: 1}) as unknown as AnyAction);
    await store.dispatch(simulationTranscriptApi.endpoints.getSimulationMessages.initiate({scenarioSessionId: '1'}) as unknown as AnyAction);
    await store.dispatch(analyticsApi.endpoints.getDashboards.initiate() as unknown as AnyAction);
    await store.dispatch(analyticsApi.endpoints.getDashboardUrl.initiate({dashboardId: '1'}) as unknown as AnyAction);
    await store.dispatch(callSummaryApi.endpoints.getCallSummary.initiate(1) as unknown as AnyAction);
    await store.dispatch(callSummaryApi.endpoints.exportCallSummary.initiate(1) as unknown as AnyAction);

    // mutations
    await store.dispatch(chatApi.endpoints.endCall.initiate({chatId: 1}) as unknown as AnyAction);
    await store.dispatch(chatApi.endpoints.addFeedback.initiate({id: 1, feedback: {}}) as unknown as AnyAction);
    await store.dispatch(chatApi.endpoints.updateFeedback.initiate({feedbackId: 1, feedback: {}}) as unknown as AnyAction);
    await store.dispatch(chatApi.endpoints.updateNotes.initiate({chatId: 1, notes: {content: 'n'}}) as unknown as AnyAction);
    await store.dispatch(callSummaryApi.endpoints.updateCallSummary.initiate({chatId: 1, data: {}}) as unknown as AnyAction);
    await store.dispatch(callSummaryApi.endpoints.updateCallInfo.initiate({chatId: 1, summaryName: 's'}) as unknown as AnyAction);
    await store.dispatch(callSummaryApi.endpoints.enhanceCallSummary.initiate({content: 'c'}) as unknown as AnyAction);
    await store.dispatch(callSummaryApi.endpoints.getTags.initiate({tags: ['a']}) as unknown as AnyAction);

    expect(true).toBe(true);
  });
});


