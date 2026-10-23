import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SCREEN_NAMES} from '@/constants';

import {SimulationPathDetailsScreen} from '../SimulationPathDetailsScreen';

// Mock dependencies
jest.mock('@react-navigation/native', () => ({
  useRoute: jest.fn(() => ({
    params: {pathId: 'test-path-id'},
  })),
  useFocusEffect: jest.fn(),
  useIsFocused: jest.fn(() => true),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  })),
}));

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'Simulations.progressCompleted') {
        return `${params?.current} of ${params?.total} completed`;
      }
      if (key === 'Simulations.simulation') {
        return 'Role-play';
      }
      const translations: Record<string, string> = {
        'learn.choose.track': 'Track way',
        'common.start': 'Start',
        'common.continue': 'Continue',
        'common.next': 'Next',
        'simulationPage.failedToLoadPathDetails': 'Failed to load path details',
        'errors.startSimulation': 'Failed to start simulation',
      };
      return translations[key] || key;
    },
  })),
  useSimulationCredits: jest.fn(() => ({
    credits: {consumedCredits: 5, creditLimit: 10},
    getCreditsInfo: {isLow: false},
  })),
  useHardwareBackPressHandler: jest.fn(),
  useStartSimulation: jest.fn(() => ({
    isCreatingRoom: false,
    isMicPermissionGranted: true,
    activeSimulationId: null,
    showActiveSimulationModal: false,
    startSimulation: jest.fn(),
    closeActiveSimulationModal: jest.fn(),
    setShowActiveSimulationModal: jest.fn(),
  })),
  useLearningPathDetails: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: jest.fn(),
    createSession: jest.fn(),
    isCreatingSession: false,
    getSessionByItem: jest.fn(),
  })),
}));

jest.mock('../components/PathSimulationCard', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    PathSimulationCard: ({title, order, isNext}: any) => (
      <View testID="path-simulation-card">
        <Text>{`${order}. ${title}`}</Text>
        {isNext && <Text testID="next-badge">Next</Text>}
      </View>
    ),
  };
});

jest.mock('../components/SimulationDetailsModal', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SimulationDetailsModal: ({visible}: any) =>
      visible ? <View testID="simulation-details-modal" /> : null,
  };
});

jest.mock('@/screens/SimulationDetailsScreen/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ActiveSimulationModal: ({visible}: any) =>
      visible ? <View testID="active-simulation-modal" /> : null,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View, TouchableOpacity, Text} = require('react-native');
  return {
    IllustratedModal: ({visible, children}: any) =>
      visible ? <View testID="illustrated-modal">{children}</View> : null,
    Button: ({label, onPress, isLoading, isDisabled}: any) => (
      <TouchableOpacity
        testID="primary-button"
        onPress={onPress}
        disabled={isDisabled || isLoading}>
        <Text>{isLoading ? 'Loading...' : label}</Text>
      </TouchableOpacity>
    ),
    CustomDropdown: ({value, options, onSelect}: any) => (
      <TouchableOpacity
        testID="custom-dropdown"
        onPress={() => onSelect && onSelect(options[0])}>
        <Text>{value || 'Select'}</Text>
      </TouchableOpacity>
    ),
    EmptyState: ({title}: any) => <Text testID="empty-state">{title}</Text>,
    NotificationModal: ({visible, title, message}: any) =>
      visible ? (
        <View testID="notification-modal">
          <Text>{title}</Text>
          <Text>{message}</Text>
        </View>
      ) : null,
    LearningPathHeader: ({title, description, coverImageUrl, onBackPress, credits}: any) => (
      <View testID="learning-path-header">
        <TouchableOpacity onPress={onBackPress}>
          <Text>Back</Text>
        </TouchableOpacity>
        <Text>{title}</Text>
        <Text>{description}</Text>
        {credits && (
          <Text>
            {credits.consumed}
            <Text>/{credits.limit}</Text>
          </Text>
        )}
      </View>
    ),
    LearningPathListHeader: ({
      title,
      description,
      completedScenarios,
      totalScenarios,
      isCompleted,
      startButtonLabel,
      onStartPress,
      isStartDisabled,
      isCreatingSession,
    }: any) => (
      <View testID="learning-path-list-header">
        <Text>{title}</Text>
        <Text>{description}</Text>
        {completedScenarios !== undefined && totalScenarios > 0 && (
          <Text>{`${completedScenarios} of ${totalScenarios} completed`}</Text>
        )}
        {!isCompleted && (
          <TouchableOpacity
            testID="primary-button"
            onPress={onStartPress}
            disabled={isStartDisabled || isCreatingSession}>
            <Text>{isCreatingSession ? 'Loading...' : startButtonLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    ),
    useToast: jest.fn(() => ({
      showToast: mockShowToast,
    })),
  };
});

const mockShowToast = jest.fn();
const mockCreatePathSession = jest.fn();
const mockGetScenarioSessionByPathItem = jest.fn();

jest.mock('@/services', () => {
  return {
    useGetSimulationPathDetailsQuery: jest.fn(),
    useCreatePathSessionMutation: jest.fn(() => [
      mockCreatePathSession,
      {isLoading: false},
    ]),
    useLazyGetScenarioSessionByPathItemQuery: jest.fn(() => [
      mockGetScenarioSessionByPathItem,
    ]),
  };
});

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
};

// Mock data matches backend API structure
const mockPathData = {
  id: 'test-path-id',
  title: 'Test Path',
  description: 'A comprehensive test path for learning and development',
  coverImageUrl: 'https://example.com/cover.jpg',
  status: 'ACTIVE',
  isGlobal: true,
  completedAt: null,
  completedScenarios: 2,
  scenarioPathSessionId: 'session-123',
  scenarios: [
    {
      id: 'item-1',
      scenarioId: 101,
      order: 1,
      coverImageUrl: 'https://example.com/sim1.jpg',
      coverVideoUrl: 'https://example.com/video1.mp4',
      description: 'Simulation 1 description',
      title: 'Simulation 1',
      sessionId: 'session-1',
      status: 'COMPLETED' as const,
    },
    {
      id: 'item-2',
      scenarioId: 102,
      order: 2,
      coverImageUrl: 'https://example.com/sim2.jpg',
      description: 'Simulation 2 description',
      title: 'Simulation 2',
      sessionId: 'session-2',
      status: 'UNLOCKED' as const,
    },
    {
      id: 'item-3',
      scenarioId: 103,
      order: 3,
      coverImageUrl: 'https://example.com/sim3.jpg',
      description: 'Simulation 3 description',
      title: 'Simulation 3',
      sessionId: null,
      status: 'LOCKED' as const,
    },
  ],
};

describe('SimulationPathDetailsScreen', () => {
  const {useLearningPathDetails} = require('@/hooks');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render loading state', () => {
    useLearningPathDetails.mockReturnValue({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByTestId} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    expect(getByTestId('activity-indicator')).toBeTruthy();
  });

  it('should render error state', () => {
    useLearningPathDetails.mockReturnValue({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: new Error('Failed to load'),
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByTestId} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    // EmptyState component is rendered
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('should render path details with simulations', () => {
    useLearningPathDetails.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByText} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    expect(getByText('Test Path')).toBeTruthy();
    expect(getByText('2 of 3 completed')).toBeTruthy();
  });

  it('should render "Start" button when path is not started', () => {
    const notStartedPathData = {
      ...mockPathData,
      completedScenarios: 0,
      scenarios: mockPathData.scenarios.map((scenario, index) => ({
        ...scenario,
        status: index === 0 ? ('IN_PROGRESS' as const) : ('LOCKED' as const),
      })),
    };

    useLearningPathDetails.mockReturnValue({
      data: notStartedPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByText} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    expect(getByText('Start')).toBeTruthy();
  });

  it('should render "Continue" button when path is started', () => {
    useLearningPathDetails.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByText} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    expect(getByText('Continue')).toBeTruthy();
  });

  it('should render simulation cards with correct states', () => {
    useLearningPathDetails.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getAllByText} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    // Check for simulation cards with order labels
    expect(getAllByText(/1\. Simulation 1/)).toHaveLength(1);
    expect(getAllByText(/2\. Simulation 2/)).toHaveLength(1);
    expect(getAllByText(/3\. Simulation 3/)).toHaveLength(1);
  });

  it('should render "Next" badge for the next simulation', () => {
    useLearningPathDetails.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByText} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    expect(getByText('Next')).toBeTruthy();
  });

  it('should call goBack when back button is pressed', () => {
    useLearningPathDetails.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {root} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    // Find the first TouchableOpacity in the header (back button)
    const touchables = root.findAllByType('TouchableOpacity' as any);
    // First touchable should be the back button
    const backButton = touchables.find(
      t => !t.props.testID || t.props.testID !== 'primary-button',
    );

    if (backButton) {
      fireEvent.press(backButton);
      expect(mockNavigation.goBack).toHaveBeenCalled();
    }
  });

  it('should display credits information', () => {
    useLearningPathDetails.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {root} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    // Check that credit display is rendered (BoltIcon + credit text structure)
    const textElements = root.findAllByType('Text' as any);
    // Credits are displayed as nested text: "5" with child "/10"
    const hasCredits = textElements.some(
      el =>
        el.props.children === 5 ||
        (Array.isArray(el.props.children) &&
          el.props.children.includes(5)),
    );
    expect(hasCredits).toBeTruthy();
  });

  it('should render header with path title', () => {
    useLearningPathDetails.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByText} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    expect(getByText('Test Path')).toBeTruthy();
  });

  it('should disable button when no next simulation is available', () => {
    const allCompletedButNotMarkedPathData = {
      ...mockPathData,
      completedScenarios: 3,
      completedAt: null, // Not marked as completed yet
      scenarios: mockPathData.scenarios.map(scenario => ({
        ...scenario,
        status: 'COMPLETED' as const,
      })),
    };

    useLearningPathDetails.mockReturnValue({
      data: allCompletedButNotMarkedPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByText, getByTestId} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    // When all scenarios are completed, there's no next simulation, so button should be disabled
    expect(getByText('Continue')).toBeTruthy();
    const button = getByTestId('primary-button');
    // Check for disabled prop or accessibilityState.disabled
    const isDisabled = button.props.disabled || button.props.accessibilityState?.disabled;
    expect(isDisabled).toBeTruthy();
  });

  it('should not show Start/Continue button when path is completed', () => {
    const completedPathData = {
      ...mockPathData,
      completedAt: '2024-01-15T10:30:00Z',
      completedScenarios: 3,
      totalScenarios: 3,
      scenarios: mockPathData.scenarios.map(scenario => ({
        ...scenario,
        status: 'COMPLETED' as const,
      })),
    };

    useLearningPathDetails.mockReturnValue({
      data: completedPathData,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {queryByText} = render(
      <SimulationPathDetailsScreen
        navigation={mockNavigation as any}
        route={{
          key: 'test',
          name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
          params: {pathId: 'test-path-id'},
        }}
      />,
    );

    // Button should not be present when path is completed
    expect(queryByText('Start')).toBeNull();
    expect(queryByText('Continue')).toBeNull();
  });
});

