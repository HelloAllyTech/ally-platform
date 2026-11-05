// Mock base API deps
jest.mock('@/store/store', () => ({ store: { dispatch: jest.fn() } }));
jest.mock('@/store/slices/userSlice', () => ({
  handleLogout: () => ({ type: 'logout' }),
  storeTokens: (p: any) => ({ type: 'storeTokens', payload: p }),
}));
jest.mock('@/utils/asyncStorage', () => ({ getItem: jest.fn(async () => undefined) }));
jest.mock('@/config/env', () => ({ env: { API_BASE_URL: 'https://example.com', API_VERSION: 'v1' } }));

import {simulationTranscriptApi} from '../simulationTranscriptApi';

describe('simulationTranscriptApi', () => {
  it('exposes getSimulationMessages endpoint', () => {
    expect((simulationTranscriptApi as any).endpoints.getSimulationMessages).toBeTruthy();
  });

  it('exposes getSimulationSessionRecording endpoint', () => {
    expect(
      (simulationTranscriptApi as any).endpoints.getSimulationSessionRecording,
    ).toBeTruthy();
  });
});


