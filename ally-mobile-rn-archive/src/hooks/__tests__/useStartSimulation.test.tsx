import {act, renderHook, waitFor} from '@testing-library/react-native';

import {useStartSimulation} from '../useStartSimulation';

const mockNavigate = jest.fn();

jest.mock('@/hooks/useAppNavigation', () => ({
  useAppNavigation: () => ({navigate: mockNavigate}),
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

  it('showRetryModal is initially false', async () => {
    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });
    expect(result.current.showRetryModal).toBe(false);
  });

  it('closeRetryModal resets showRetryModal to false', async () => {
    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });

    act(() => {
      result.current.closeRetryModal();
    });

    expect(result.current.showRetryModal).toBe(false);
  });

  it('retryStartSimulation returns false when no params stored', async () => {
    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });

    let retryResult: boolean | undefined;
    await act(async () => {
      retryResult = await result.current.retryStartSimulation();
    });

    expect(retryResult).toBe(false);
  });

  it('startSimulation sets showRetryModal when 429 error occurs', async () => {
    const {useStartScenarioSessionMutation} = require('@/services');
    useStartScenarioSessionMutation.mockReturnValue([
      jest.fn().mockReturnValue({
        unwrap: jest.fn().mockRejectedValue({status: 429}),
      }),
    ]);

    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });

    await act(async () => {
      await result.current.startSimulation({scenarioId: 1});
    });

    expect(result.current.showRetryModal).toBe(true);
  });

  it('startSimulation shows active simulation modal on entityId error', async () => {
    const {useStartScenarioSessionMutation} = require('@/services');
    useStartScenarioSessionMutation.mockReturnValue([
      jest.fn().mockReturnValue({
        unwrap: jest
          .fn()
          .mockRejectedValue({data: {entityId: 'active-sim-1'}}),
      }),
    ]);

    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });

    await act(async () => {
      await result.current.startSimulation({scenarioId: 1});
    });

    expect(result.current.showActiveSimulationModal).toBe(true);
    expect(result.current.activeSimulationId).toBe('active-sim-1');
  });

  it('passes reminders through when remindersEnabled is true', async () => {
    const {useStartScenarioSessionMutation} = require('@/services');
    useStartScenarioSessionMutation.mockReturnValue([
      jest.fn().mockReturnValue({
        unwrap: jest.fn().mockResolvedValue({
          scenarioSession: {id: 's1'},
          accessToken: {token: 'tok', serverUrl: 'url'},
          scenario: {
            id: 1,
            reminders: ['Maintain eye contact'],
            remindersEnabled: true,
          },
        }),
      }),
    ]);

    const {result} = renderHook(() => useStartSimulation());
    await waitFor(() => {
      expect(result.current.isMicPermissionGranted).toBe(true);
    });

    await act(async () => {
      await result.current.startSimulation({scenarioId: 1});
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      'SimulationAssistant',
      expect.objectContaining({
        scenario: expect.objectContaining({
          reminders: ['Maintain eye contact'],
        }),
      }),
    );
  });

  it.each([[false], [undefined]])(
    'strips reminders when remindersEnabled is %s',
    async remindersEnabled => {
      const {useStartScenarioSessionMutation} = require('@/services');
      useStartScenarioSessionMutation.mockReturnValue([
        jest.fn().mockReturnValue({
          unwrap: jest.fn().mockResolvedValue({
            scenarioSession: {id: 's1'},
            accessToken: {token: 'tok', serverUrl: 'url'},
            scenario: {
              id: 1,
              reminders: ['Maintain eye contact'],
              remindersEnabled,
            },
          }),
        }),
      ]);

      const {result} = renderHook(() => useStartSimulation());
      await waitFor(() => {
        expect(result.current.isMicPermissionGranted).toBe(true);
      });

      await act(async () => {
        await result.current.startSimulation({scenarioId: 1});
      });

      expect(mockNavigate).toHaveBeenCalledWith(
        'SimulationAssistant',
        expect.objectContaining({
          scenario: expect.objectContaining({reminders: []}),
        }),
      );
    },
  );
});
