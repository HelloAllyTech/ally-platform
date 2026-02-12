import {renderHook, waitFor} from '@testing-library/react-native';

import {SimulationEventStatus} from '@/constants';
import {SessionItemStatus} from '@/types';

// Mock the useStartSimulation hook BEFORE importing useSimulationTransition
jest.mock('../useStartSimulation', () => ({
  useStartSimulation: jest.fn(() => ({
    startSimulation: jest.fn(),
    isCreatingRoom: false,
  })),
}));

// Mock the API hooks
jest.mock('@/services', () => ({
  useGetUpcomingScenarioQuery: jest.fn(),
  useGetUpcomingCaseScenarioQuery: jest.fn(),
}));

import {useSimulationTransition} from '../useSimulationTransition';

const mockUseGetUpcomingScenarioQuery =
  require('@/services').useGetUpcomingScenarioQuery;
const mockUseGetUpcomingCaseScenarioQuery =
  require('@/services').useGetUpcomingCaseScenarioQuery;

describe('useSimulationTransition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock for case query
    mockUseGetUpcomingCaseScenarioQuery.mockReturnValue({
      data: undefined,
      fulfilledTimeStamp: undefined,
      isLoading: false,
    });
  });

  it('should return initial state when no data is available', () => {
    mockUseGetUpcomingScenarioQuery.mockReturnValue({
      data: undefined,
      fulfilledTimeStamp: undefined,
      isLoading: true,
    });

    const {result} = renderHook(() =>
      useSimulationTransition({
        scenarioSessionId: '123',
        pathId: '456',
        enabled: true,
      }),
    );

    expect(result.current.currentSession).toBeUndefined();
    expect(result.current.upcomingScenario).toBeUndefined();
    expect(result.current.isEventCompleted).toBe(false);
    expect(result.current.isFlowCompleted).toBe(false);
    expect(result.current.hasUpcoming).toBe(false);
    expect(result.current.canRetryCurrentSession).toBe(false);
    expect(result.current.isCurrentSessionCompleted).toBe(false);
    expect(result.current.isLoading).toBe(true);
    expect(typeof result.current.retrySimulation).toBe('function');
    expect(typeof result.current.startNextSimulation).toBe('function');
    expect(result.current.isStartingSimulation).toBe(false);
  });

  it('should return correct state when event is completed', () => {
    const mockData = {
      currentSession: {
        scenarioId: 1,
        scenarioPathSessionItemId: '123',
        eventStatus: SimulationEventStatus.COMPLETED,
        scenarioPathSessionItemStatus: SessionItemStatus.COMPLETED,
        isScenarioPathSessionCompleted: false,
      },
      upcomingScenario: {
        id: 2,
        title: 'Next Scenario',
        scenarioPathSessionItemId: '456',
      },
    };

    mockUseGetUpcomingScenarioQuery.mockReturnValue({
      data: mockData,
      fulfilledTimeStamp: Date.now(),
      isLoading: false,
    });

    const {result} = renderHook(() =>
      useSimulationTransition({
        scenarioSessionId: '123',
        pathId: '456',
        enabled: true,
      }),
    );

    expect(result.current.currentSession).toEqual(mockData.currentSession);
    expect(result.current.upcomingScenario).toEqual(mockData.upcomingScenario);
    expect(result.current.isEventCompleted).toBe(true);
    expect(result.current.isFlowCompleted).toBe(false);
    expect(result.current.hasUpcoming).toBe(true);
    expect(result.current.canRetryCurrentSession).toBe(false);
    expect(result.current.isCurrentSessionCompleted).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('should indicate can retry when session is not completed', () => {
    const mockData = {
      currentSession: {
        scenarioId: 1,
        scenarioPathSessionItemId: '123',
        eventStatus: SimulationEventStatus.COMPLETED,
        scenarioPathSessionItemStatus: SessionItemStatus.COMPLETED,
        isScenarioPathSessionCompleted: false,
      },
    };

    mockUseGetUpcomingScenarioQuery.mockReturnValue({
      data: mockData,
      fulfilledTimeStamp: Date.now(),
      isLoading: false,
    });

    const {result} = renderHook(() =>
      useSimulationTransition({
        scenarioSessionId: '123',
        pathId: '456',
        enabled: true,
      }),
    );

    expect(result.current.canRetryCurrentSession).toBe(true);
    expect(result.current.isCurrentSessionCompleted).toBe(false);
  });

  it('should indicate path is completed', () => {
    const mockData = {
      currentSession: {
        scenarioId: 1,
        scenarioPathSessionItemId: '123',
        eventStatus: SimulationEventStatus.COMPLETED,
        scenarioPathSessionItemStatus: SessionItemStatus.COMPLETED,
        isScenarioPathSessionCompleted: true,
      },
    };

    mockUseGetUpcomingScenarioQuery.mockReturnValue({
      data: mockData,
      fulfilledTimeStamp: Date.now(),
      isLoading: false,
    });

    const {result} = renderHook(() =>
      useSimulationTransition({
        scenarioSessionId: '123',
        pathId: '456',
        enabled: true,
      }),
    );

    expect(result.current.isFlowCompleted).toBe(true);
  });

  it('should skip query when enabled is false', () => {
    mockUseGetUpcomingScenarioQuery.mockReturnValue({
      data: undefined,
      fulfilledTimeStamp: undefined,
      isLoading: false,
    });

    renderHook(() =>
      useSimulationTransition({
        scenarioSessionId: '123',
        pathId: '456',
        enabled: false,
      }),
    );

    expect(mockUseGetUpcomingScenarioQuery).toHaveBeenCalledWith(
      {scenarioSessionId: '123'},
      expect.objectContaining({
        skip: true,
      }),
    );
  });

  it('should skip query when pathId is not provided', () => {
    mockUseGetUpcomingScenarioQuery.mockReturnValue({
      data: undefined,
      fulfilledTimeStamp: undefined,
      isLoading: false,
    });

    renderHook(() =>
      useSimulationTransition({
        scenarioSessionId: '123',
        enabled: true,
      }),
    );

    expect(mockUseGetUpcomingScenarioQuery).toHaveBeenCalledWith(
      {scenarioSessionId: '123'},
      expect.objectContaining({
        skip: true,
      }),
    );
  });

  describe('Case flow', () => {
    beforeEach(() => {
      // Mock path query to return nothing for case flow tests
      mockUseGetUpcomingScenarioQuery.mockReturnValue({
        data: undefined,
        fulfilledTimeStamp: undefined,
        isLoading: false,
      });
    });

    it('should use case API when caseId is provided', () => {
      const mockData = {
        currentSession: {
          scenarioId: 1,
          scenarioPathSessionItemId: '123',
          eventStatus: SimulationEventStatus.COMPLETED,
          scenarioPathSessionItemStatus: SessionItemStatus.COMPLETED,
          isScenarioPathSessionCompleted: false,
        },
        upcomingScenario: {
          id: 2,
          title: 'Next Case Scenario',
          scenarioPathSessionItemId: '456',
        },
      };

      mockUseGetUpcomingCaseScenarioQuery.mockReturnValue({
        data: mockData,
        fulfilledTimeStamp: Date.now(),
        isLoading: false,
      });

      const {result} = renderHook(() =>
        useSimulationTransition({
          scenarioSessionId: '123',
          caseId: '789',
          enabled: true,
        }),
      );

      expect(result.current.currentSession).toEqual(mockData.currentSession);
      expect(result.current.upcomingScenario).toEqual(
        mockData.upcomingScenario,
      );
      expect(result.current.isEventCompleted).toBe(true);
      expect(mockUseGetUpcomingCaseScenarioQuery).toHaveBeenCalledWith(
        {scenarioSessionId: '123'},
        expect.objectContaining({
          skip: false,
        }),
      );
    });

    it('should skip case query when caseId is not provided', () => {
      mockUseGetUpcomingCaseScenarioQuery.mockReturnValue({
        data: undefined,
        fulfilledTimeStamp: undefined,
        isLoading: false,
      });

      renderHook(() =>
        useSimulationTransition({
          scenarioSessionId: '123',
          enabled: true,
        }),
      );

      expect(mockUseGetUpcomingCaseScenarioQuery).toHaveBeenCalledWith(
        {scenarioSessionId: '123'},
        expect.objectContaining({
          skip: true,
        }),
      );
    });

    it('should use case loading state when caseId is provided', () => {
      mockUseGetUpcomingCaseScenarioQuery.mockReturnValue({
        data: undefined,
        fulfilledTimeStamp: undefined,
        isLoading: true,
      });

      const {result} = renderHook(() =>
        useSimulationTransition({
          scenarioSessionId: '123',
          caseId: '789',
          enabled: true,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });
  });
});
