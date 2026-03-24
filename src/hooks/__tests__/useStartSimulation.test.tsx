import {act, renderHook, waitFor} from '@testing-library/react-native';

import {useStartSimulation} from '../useStartSimulation';

jest.mock('@/hooks/useAppNavigation', () => ({
  useAppNavigation: () => ({navigate: jest.fn()}),
}));

jest.mock('@/hooks/useTranslate', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks/usePermissionAlert', () => ({
  usePermissionAlert: () => ({showSettingsAlert: jest.fn()}),
}));

jest.mock('@/components', () => ({
  useErrorToast: () => ({showErrorToast: jest.fn()}),
}));

jest.mock('@/services', () => ({
  useStartScenarioSessionMutation: jest.fn(() => [
    jest.fn().mockReturnValue({
      unwrap: jest.fn().mockResolvedValue({
        scenarioSession: {id: 's1'},
        accessToken: {token: 'tok', serverUrl: 'url'},
        scenario: {id: 1},
      }),
    }),
  ]),
}));

jest.mock('@/constants', () => ({
  MICROPHONE_PERMISSION: 'android.permission.RECORD_AUDIO',
  SCREEN_NAMES: {SIMULATION_ASSISTANT: 'SimulationAssistant'},
}));

jest.mock('react-native-permissions', () => ({
  check: jest.fn().mockResolvedValue('granted'),
  request: jest.fn().mockResolvedValue('granted'),
  openSettings: jest.fn(),
  RESULTS: {GRANTED: 'granted', BLOCKED: 'blocked', DENIED: 'denied'},
}));

describe('useStartSimulation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with isCreatingRoom false', async () => {
    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });

    expect(result.current.isCreatingRoom).toBe(false);
  });

  it('initializes with showActiveSimulationModal false', async () => {
    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });

    expect(result.current.showActiveSimulationModal).toBe(false);
  });

  it('closeActiveSimulationModal resets state', async () => {
    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });

    act(() => {
      result.current.setShowActiveSimulationModal(true);
    });
    expect(result.current.showActiveSimulationModal).toBe(true);

    act(() => {
      result.current.closeActiveSimulationModal();
    });

    expect(result.current.showActiveSimulationModal).toBe(false);
    expect(result.current.activeSimulationId).toBeNull();
  });

  it('isMicPermissionGranted is true after check resolves with GRANTED', async () => {
    const {result} = renderHook(() => useStartSimulation());

    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });
  });
});
