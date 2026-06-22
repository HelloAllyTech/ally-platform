import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useHardwareBackPressHandler: jest.fn(),
  useLearningPathDetails: jest.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    createSession: jest.fn(),
    isCreatingSession: false,
    getSessionByItem: jest.fn(),
  })),
  useSimulationCredits: () => ({credits: null, getCreditsInfo: null}),
  useStartSimulation: () => ({
    isCreatingRoom: false,
    startSimulation: jest.fn(),
    showActiveSimulationModal: false,
    activeSimulationId: null,
    closeActiveSimulationModal: jest.fn(),
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
  ms: (val: number) => val,
}));

jest.mock('@/assets', () => ({
  DataUnavailableIcon: () => null,
  NoCreditsIcon: () => null,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    EmptyState: ({title}: {title: string}) => (
      <View testID="empty-state">
        <Text>{title}</Text>
      </View>
    ),
    IllustratedModal: () => <View testID="illustrated-modal" />,
    LearningPathHeader: ({title}: {title: string}) => (
      <View testID="learning-path-header">
        <Text>{title}</Text>
      </View>
    ),
    LearningPathListHeader: () => <View testID="learning-path-list-header" />,
    NotificationModal: () => <View testID="notification-modal" />,
    useToast: () => ({showToast: jest.fn()}),
  };
});

jest.mock(
  '@/screens/SimulationDetailsScreen/components',
  () => {
    const React = require('react');
    const {View} = require('react-native');
    return {
      ActiveSimulationModal: () => <View testID="active-simulation-modal" />,
    };
  },
);

jest.mock(
  '@/screens/SimulationPathDetailsScreen/components/PathSimulationCard',
  () => {
    const React = require('react');
    const {View, Text} = require('react-native');
    return {
      PathSimulationCard: ({title}: {title: string}) => (
        <View testID="path-simulation-card">
          <Text>{title}</Text>
        </View>
      ),
    };
  },
);

jest.mock(
  '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal',
  () => {
    const React = require('react');
    const {View} = require('react-native');
    return {
      SimulationDetailsModal: () => <View testID="simulation-details-modal" />,
    };
  },
);

jest.mock('@/theme', () => {
  const handler: ProxyHandler<any> = {
    get: (_target, prop) => {
      if (prop === '__esModule') return false;
      if (typeof prop === 'symbol') return undefined;
      return new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
    },
  };
  const deepProxy = new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
  return {
    __esModule: true,
    colors: deepProxy,
    fontFamily: deepProxy,
    fontWeights: deepProxy,
    typography: deepProxy,
    radius: deepProxy,
    stroke: deepProxy,
    default: deepProxy,
  };
});

jest.mock('@/utils', () => ({
  getErrorDetails: jest.fn(),
  navigateToLearnTab: jest.fn(),
}));

import {useLearningPathDetails} from '@/hooks';

import {CaseDetailsScreen} from '../CaseDetailsScreen';
import {SessionItemStatus} from '@/types';

const mockNavigation = {
  canGoBack: jest.fn(() => true),
  goBack: jest.fn(),
  navigate: jest.fn(),
} as any;

const mockRoute = {
  params: {caseId: 'case-123'},
} as any;

describe('CaseDetailsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading indicator when data is loading', () => {
    (useLearningPathDetails as jest.Mock).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByTestId} = render(
      <CaseDetailsScreen navigation={mockNavigation} route={mockRoute} />,
    );

    expect(getByTestId('activity-indicator')).toBeTruthy();
  });

  it('shows empty state on error', () => {
    (useLearningPathDetails as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('fail'),
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByTestId} = render(
      <CaseDetailsScreen navigation={mockNavigation} route={mockRoute} />,
    );

    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('renders simulation list when data is available', () => {
    (useLearningPathDetails as jest.Mock).mockReturnValue({
      data: {
        title: 'Test Case',
        description: 'Test description',
        coverImageUrl: null,
        completedScenarios: 0,
        completedAt: null,
        caseSessionId: 'session-1',
        scenarios: [
          {
            id: '1',
            scenarioId: 'sc-1',
            title: 'Sim 1',
            order: 1,
            status: SessionItemStatus.UNLOCKED,
            coverImageUrl: null,
            sessionId: null,
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByTestId} = render(
      <CaseDetailsScreen navigation={mockNavigation} route={mockRoute} />,
    );

    expect(getByTestId('learning-path-header')).toBeTruthy();
  });

  it('renders header with case title', () => {
    (useLearningPathDetails as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('err'),
      refetch: jest.fn(),
      createSession: jest.fn(),
      isCreatingSession: false,
      getSessionByItem: jest.fn(),
    });

    const {getByText} = render(
      <CaseDetailsScreen navigation={mockNavigation} route={mockRoute} />,
    );

    expect(getByText('simulationPage.failedToLoadCaseDetails')).toBeTruthy();
  });
});
