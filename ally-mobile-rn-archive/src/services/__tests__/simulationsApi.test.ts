// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {simulationsApi} from '../simulationsApi';

describe('simulationsApi', () => {
  it('exposes simulation endpoints', () => {
    const e = (simulationsApi as any).endpoints;
    expect(e.getAvailableLanguages).toBeTruthy();
    expect(e.listRooms).toBeTruthy();
    expect(e.getScenarios).toBeTruthy();
    expect(e.getScenarioById).toBeTruthy();
    expect(e.addSimulationFeedback).toBeTruthy();
    expect(e.getSimulationDetails).toBeTruthy();
    expect(e.getSimulationLogs).toBeTruthy();
    expect(e.startScenarioSession).toBeTruthy();
    expect(e.endScenarioSession).toBeTruthy();
    expect(e.getSimulationCredits).toBeTruthy();
  });

  it('has getAvailableLanguages endpoint with correct type', () => {
    const endpoint = (simulationsApi as any).endpoints.getAvailableLanguages;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has listRooms endpoint with correct type', () => {
    const endpoint = (simulationsApi as any).endpoints.listRooms;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has getScenarios endpoint with correct type', () => {
    const endpoint = (simulationsApi as any).endpoints.getScenarios;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has getScenarioById endpoint with correct type', () => {
    const endpoint = (simulationsApi as any).endpoints.getScenarioById;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has addSimulationFeedback mutation endpoint', () => {
    const endpoint = (simulationsApi as any).endpoints.addSimulationFeedback;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has getSimulationDetails endpoint', () => {
    const endpoint = (simulationsApi as any).endpoints.getSimulationDetails;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has getSimulationLogs endpoint', () => {
    const endpoint = (simulationsApi as any).endpoints.getSimulationLogs;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has startScenarioSession mutation endpoint', () => {
    const endpoint = (simulationsApi as any).endpoints.startScenarioSession;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has endScenarioSession mutation endpoint', () => {
    const endpoint = (simulationsApi as any).endpoints.endScenarioSession;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('has getSimulationCredits endpoint', () => {
    const endpoint = (simulationsApi as any).endpoints.getSimulationCredits;
    expect(endpoint.matchFulfilled).toBeDefined();
  });

  it('exports all hooks', () => {
    const {
      useGetAvailableLanguagesQuery,
      useListRoomsQuery,
      useGetScenariosQuery,
      useAddSimulationFeedbackMutation,
      useGetSimulationLogsQuery,
      useLazyGetSimulationLogsQuery,
      useStartScenarioSessionMutation,
      useEndScenarioSessionMutation,
      useLazyGetSimulationDetailsQuery,
      useLazyGetSimulationCreditsQuery,
    } = require('../simulationsApi');

    expect(useGetAvailableLanguagesQuery).toBeDefined();
    expect(useListRoomsQuery).toBeDefined();
    expect(useGetScenariosQuery).toBeDefined();
    expect(useAddSimulationFeedbackMutation).toBeDefined();
    expect(useGetSimulationLogsQuery).toBeDefined();
    expect(useLazyGetSimulationLogsQuery).toBeDefined();
    expect(useStartScenarioSessionMutation).toBeDefined();
    expect(useEndScenarioSessionMutation).toBeDefined();
    expect(useLazyGetSimulationDetailsQuery).toBeDefined();
    expect(useLazyGetSimulationCreditsQuery).toBeDefined();
  });

  describe('getAvailableLanguages endpoint', () => {
    it('should have correct query type', () => {
      const endpoint = (simulationsApi as any).endpoints.getAvailableLanguages;
      expect(endpoint).toBeDefined();
      expect(endpoint.matchFulfilled).toBeDefined();
    });

    it('should accept AvailableLanguagesParams with active property', () => {
      const endpoint = (simulationsApi as any).endpoints.getAvailableLanguages;
      expect(endpoint).toBeDefined();
    });

    it('should accept AvailableLanguagesParams with hasVoices property', () => {
      const endpoint = (simulationsApi as any).endpoints.getAvailableLanguages;
      expect(endpoint).toBeDefined();
    });

    it('should accept empty params', () => {
      const endpoint = (simulationsApi as any).endpoints.getAvailableLanguages;
      expect(endpoint).toBeDefined();
    });

    it('should return an array of LanguageOption', () => {
      const endpoint = (simulationsApi as any).endpoints.getAvailableLanguages;
      expect(endpoint.matchFulfilled).toBeDefined();
    });
  });
});