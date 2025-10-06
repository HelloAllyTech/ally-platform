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
    expect(e.listRooms).toBeTruthy();
    expect(e.deleteRoom).toBeTruthy();
    expect(e.getScenarios).toBeTruthy();
    expect(e.getScenarioById).toBeTruthy();
    expect(e.addSimulationFeedback).toBeTruthy();
    expect(e.getSimulationDetails).toBeTruthy();
    expect(e.getSimulationLogs).toBeTruthy();
    expect(e.startScenarioSession).toBeTruthy();
    expect(e.endScenarioSession).toBeTruthy();
  });
});


