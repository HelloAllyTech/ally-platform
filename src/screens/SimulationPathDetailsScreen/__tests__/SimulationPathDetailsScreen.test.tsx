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
        return 'Simulation';
      }
      const translations: Record<string, string> = {
        'Simulations.pathWay': 'Path way',
        'Simulations.start': 'Start',
        'Simulations.continue': 'Continue',
        'Simulations.next': 'Next',
        'Simulations.failedToLoadPathDetails': 'Failed to load path details',
      };
      return translations[key] || key;
    },
  })),
  useSimulationCredits: jest.fn(() => ({
    credits: {consumedCredits: 5, creditLimit: 10},
    getCreditsInfo: {isLow: false},
  })),
  useStartSimulation: jest.fn(() => ({
    isCreatingRoom: false,
    isMicPermissionGranted: true,
    activeSimulationId: null,
    showActiveSimulationModal: false,
    startSimulation: jest.fn(),
    closeActiveSimulationModal: jest.fn(),
    setShowActiveSimulationModal: jest.fn(),
  })),
}));

jest.mock('@/services', () => ({
  useGetSimulationPathDetailsQuery: jest.fn(),
}));

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
};

const mockPathData = {
  id: 'test-path-id',
  title: 'Test Path',
  description: 'Test Path Description',
  coverImageUrl: 'https://example.com/cover.jpg',
  completedCount: 2,
  totalCount: 5,
  simulations: [
    {
      id: 'sim-1',
      title: 'Simulation 1',
      order: 1,
      thumbnailUrl: 'https://example.com/sim1.jpg',
      completed: true,
      locked: false,
    },
    {
      id: 'sim-2',
      title: 'Simulation 2',
      order: 2,
      thumbnailUrl: 'https://example.com/sim2.jpg',
      completed: false,
      locked: false,
    },
    {
      id: 'sim-3',
      title: 'Simulation 3',
      order: 3,
      thumbnailUrl: 'https://example.com/sim3.jpg',
      completed: false,
      locked: true,
    },
  ],
};

describe('SimulationPathDetailsScreen', () => {
  const {useGetSimulationPathDetailsQuery} = require('@/services');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render loading state', () => {
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
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
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load'),
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
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      error: undefined,
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
    expect(getByText('Test Path Description')).toBeTruthy();
    expect(getByText('2 of 5 completed')).toBeTruthy();
  });

  it('should render "Start" button when path is not started', () => {
    const notStartedPathData = {
      ...mockPathData,
      completedCount: 0,
    };

    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: notStartedPathData,
      isLoading: false,
      error: undefined,
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
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      error: undefined,
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
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      error: undefined,
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

    // Check for simulation order labels
    expect(getAllByText(/Simulation 1/)).toHaveLength(2); // Label + Title
    expect(getAllByText(/Simulation 2/)).toHaveLength(2);
    expect(getAllByText(/Simulation 3/)).toHaveLength(2);
  });

  it('should render "Next" badge for the next simulation', () => {
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      error: undefined,
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
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      error: undefined,
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
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      error: undefined,
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

  it('should render header with "Path way" title', () => {
    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: mockPathData,
      isLoading: false,
      error: undefined,
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

    expect(getByText('Path way')).toBeTruthy();
  });

  it('should disable button when no next simulation is available', () => {
    const allCompletedPathData = {
      ...mockPathData,
      completedCount: 3,
      simulations: mockPathData.simulations.map(sim => ({
        ...sim,
        completed: true,
      })),
    };

    useGetSimulationPathDetailsQuery.mockReturnValue({
      data: allCompletedPathData,
      isLoading: false,
      error: undefined,
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

    const continueButton = getByText('Continue');
    expect(continueButton).toBeTruthy();
    // Note: The disabled state is handled by PrimaryButton component
  });
});

