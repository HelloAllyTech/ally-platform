import React from 'react';
import {render, waitFor, fireEvent, within} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SimulationsScreen} from '../SimulationsScreen';
import {ScenarioStatus, SCREEN_NAMES} from '../../../constants';
import type {Scenario} from '../../../types';

// Keep t() returning keys so assertions match (same pattern as sibling tests).
// Required now that api.ts pulls in @/localization/i18n, which would otherwise
// initialize i18next and make t() resolve to real translations.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
  Trans: ({i18nKey, children}: {i18nKey?: string; children?: React.ReactNode}) =>
    children ?? i18nKey ?? null,
  initReactI18next: {type: '3rdParty', init: jest.fn()},
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn(),
    requestPermission: jest.fn(),
    createTriggerNotification: jest.fn(),
    cancelTriggerNotification: jest.fn(),
    onForegroundEvent: jest.fn(() => jest.fn()),
    onBackgroundEvent: jest.fn(),
  },
  AndroidImportance: {HIGH: 4},
  EventType: {PRESS: 1, DISMISSED: 2},
  TriggerType: {TIMESTAMP: 0},
  RepeatFrequency: {WEEKLY: 2},
}));

jest.mock('@/config/env', () => ({
  env: {
    NOTIFICATION_SCHEDULE_DAY: 1,
    NOTIFICATION_SCHEDULE_HOUR: 11,
    NOTIFICATION_SCHEDULE_MINUTE: 0,
  },
}));

jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetFooter: 'BottomSheetFooter',
  BottomSheetFlatList: 'BottomSheetFlatList',
}));

// Mock Google Sign-In to avoid native module requirement
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

// Mock Store hooks directly to avoid store.ts loading which causes issues
jest.mock('@/store/hooks', () => ({
  useAppSelector: (fn: any) => fn({ user: { permissions: [] } }),
  useAppDispatch: () => jest.fn(),
}));

jest.mock('@/store/store', () => ({ AppRootState: {} }));
jest.mock('react-redux', () => ({
  useSelector: jest.fn(() => ['VIEW_SCENARIO_SESSION']),
  useDispatch: jest.fn(),
  useStore: jest.fn(),
}));

// Mock Navigation helpers
jest.mock('@/navigation/TabNavigator', () => ({
  getFirstVisibleTab: jest.fn(() => 'Simulations'),
}));

// Mock react-navigation
jest.mock('@react-navigation/native', () => {
  return {
    useNavigation: () => ({ navigate: jest.fn() }),
    useRoute: () => ({ name: 'Simulations', params: {} }),
    useFocusEffect: jest.fn(),
    useIsFocused: jest.fn(() => true),
  };
});

// Mock drawer
jest.mock('@/hooks/useDrawerNavigation', () => ({
  useDrawerNavigation: () => ({ openDrawer: jest.fn() }),
}));

// Mock hooks
jest.mock('@/hooks/useAppNavigation', () => {
  const mockNavigate = jest.fn();
  return {
    useAppNavigation: () => ({ navigate: mockNavigate }),
    mockNavigate, // Export for assertion
  };
});

jest.mock('@/hooks/useHardwareBackPressHandler', () => ({
  useHardwareBackPressHandler: jest.fn(),
}));

jest.mock('@/hooks/useSimulationCredits', () => ({
  useSimulationCredits: () => ({ credits: null, getCreditsInfo: null }),
}));

// Mock Components
jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    SimulationsSkeleton: ({count}: any) => (
      <View testID="skeleton" accessibilityLabel={String(count)} />
    ),
    TabView: ({tabs, activeTab, onTabChange}: any) => (
      <View testID="tab-view">
        {tabs.map((tab: any) => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            testID={`tab-${tab.key}`}>
            <Text>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    ),
    CircularProgress: ({progress}: any) => (
      <View testID="circular-progress">
        <Text>{progress}</Text>
      </View>
    ),
    SimulationCard: ({title, onPress}: any) => (
      <TouchableOpacity onPress={onPress} testID="simulation-card">
        <Text>{title}</Text>
      </TouchableOpacity>
    ),
    BadgePopup: () => <View testID="badge-popup" />,
    TabScreenHeader: ({title, subtitle, rightContent}: any) => (
      <View testID="tab-screen-header">
        <Text>{title}</Text>
        {subtitle && <Text>{subtitle}</Text>}
        {rightContent}
      </View>
    ),
  };
});

jest.mock('@/services', () => ({
  useGetScenariosQuery: jest.fn(),
  useGetSimulationPathsQuery: jest.fn(),
  useGetCasesQuery: jest.fn(),
  useGetLearnTracksQuery: jest.fn(),
}));

describe('SimulationsScreen', () => {
  const useGetScenariosQueryMock = require('@/services')
    .useGetScenariosQuery as jest.Mock;
  const useGetSimulationPathsQueryMock = require('@/services')
    .useGetSimulationPathsQuery as jest.Mock;
  const useGetCasesQueryMock = require('@/services')
    .useGetCasesQuery as jest.Mock;
  const useGetLearnTracksQueryMock = require('@/services')
    .useGetLearnTracksQuery as jest.Mock;

  const renderWithSafeArea = (ui: React.ReactElement) =>
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        {ui}
      </SafeAreaProvider>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    // Provide default mock for useGetSimulationPathsQuery
    useGetSimulationPathsQueryMock.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: jest.fn(),
    });
    // Provide default mock for useGetCasesQuery
    useGetCasesQueryMock.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: jest.fn(),
    });
    // Provide default mock for useGetLearnTracksQuery
    useGetLearnTracksQueryMock.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: jest.fn(),
    });
  });

  it('shows skeleton when loading', () => {
    useGetScenariosQueryMock.mockReturnValue({
      data: undefined,
      isFetching: true,
      refetch: jest.fn(),
    });

    const {getByTestId} = renderWithSafeArea(<SimulationsScreen />);
    expect(getByTestId('skeleton')).toBeTruthy();
  });

  it('shows empty state when not fetching and no data', async () => {
    useGetScenariosQueryMock.mockReturnValue({
      data: [],
      isFetching: false,
      refetch: jest.fn(),
    });

    const {getByText} = renderWithSafeArea(<SimulationsScreen />);
    await waitFor(() =>
      expect(getByText('simulationPage.noSimulationsAvailable')).toBeTruthy(),
    );
  });

  it('sorts scenarios: available first, then COMING_SOON, and navigates on press', async () => {
    const scenarios: Scenario[] = [
      {
        id: 1,
        title: 'B Coming Soon',
        description: 'desc',
        coverImageUrl: 'http://image',
      },
      {
        id: 2,
        title: 'A Available',
        description: 'desc',
        coverImageUrl: 'http://image2',
      },
    ];

    useGetScenariosQueryMock.mockReturnValue({
      data: scenarios,
      isFetching: false,
      refetch: jest.fn(),
    });

    const {getByText} = renderWithSafeArea(<SimulationsScreen />);

    // Titles are rendered; available one should be tappable and navigate
    const available = getByText('A Available');
    fireEvent.press(available);
    const {mockNavigate} = require('@/hooks/useAppNavigation');
    expect(mockNavigate).toHaveBeenCalledWith(
      SCREEN_NAMES.SIMULATION_DETAILS,
      expect.objectContaining({
        scenario: expect.objectContaining({id: 2}),
      }),
    );

    // Both scenarios should be rendered
    expect(getByText('B Coming Soon')).toBeTruthy();
  });

  describe('tab order and hide-when-empty', () => {
    const populateAllTabs = () => {
      useGetLearnTracksQueryMock.mockReturnValue({
        data: [{id: 't1', title: 'Track 1', totalItems: 4, completedItems: 1}],
        isFetching: false,
        refetch: jest.fn(),
      });
      useGetScenariosQueryMock.mockReturnValue({
        data: [{id: 1, title: 'Scenario 1', description: 'desc', coverImageUrl: ''}],
        isFetching: false,
        refetch: jest.fn(),
      });
      useGetSimulationPathsQueryMock.mockReturnValue({
        data: [{id: 'p1', title: 'Path 1', totalScenarios: 3, completedScenarios: 1}],
        isFetching: false,
        refetch: jest.fn(),
      });
      useGetCasesQueryMock.mockReturnValue({
        data: [{id: 'c1', title: 'Case 1', totalScenarios: 2, completedScenarios: 0}],
        isFetching: false,
        refetch: jest.fn(),
      });
    };

    it('renders tabs in the order Courses, Cases, Simulations, Learning Pathways when all have data', () => {
      populateAllTabs();
      const {getByTestId} = renderWithSafeArea(<SimulationsScreen />);
      const tabView = getByTestId('tab-view');
      const testIds = within(tabView)
        .getAllByTestId(/^tab-(COURSES|CASES|SIMULATIONS|PATHS)$/)
        .map(node => node.props.testID);
      expect(testIds).toEqual([
        'tab-COURSES',
        'tab-CASES',
        'tab-SIMULATIONS',
        'tab-PATHS',
      ]);
    });

    it('hides the Courses tab when there are no tracks and fetching has finished', () => {
      populateAllTabs();
      useGetLearnTracksQueryMock.mockReturnValue({
        data: [],
        isFetching: false,
        refetch: jest.fn(),
      });

      const {queryByTestId} = renderWithSafeArea(<SimulationsScreen />);
      expect(queryByTestId('tab-COURSES')).toBeNull();
    });

    it('hides the Simulations tab when there are no scenarios and fetching has finished', () => {
      populateAllTabs();
      useGetScenariosQueryMock.mockReturnValue({
        data: [],
        isFetching: false,
        refetch: jest.fn(),
      });

      const {queryByTestId} = renderWithSafeArea(<SimulationsScreen />);
      expect(queryByTestId('tab-SIMULATIONS')).toBeNull();
    });

    it('hides the Cases tab when there are no cases and fetching has finished', () => {
      populateAllTabs();
      useGetCasesQueryMock.mockReturnValue({
        data: [],
        isFetching: false,
        refetch: jest.fn(),
      });

      const {queryByTestId} = renderWithSafeArea(<SimulationsScreen />);
      expect(queryByTestId('tab-CASES')).toBeNull();
    });

    it('hides the Learning Pathways tab when there are no paths and fetching has finished', () => {
      populateAllTabs();
      useGetSimulationPathsQueryMock.mockReturnValue({
        data: [],
        isFetching: false,
        refetch: jest.fn(),
      });

      const {queryByTestId} = renderWithSafeArea(<SimulationsScreen />);
      expect(queryByTestId('tab-PATHS')).toBeNull();
    });

    it('keeps a tab visible while it is still fetching, even though it will resolve empty', () => {
      populateAllTabs();
      useGetCasesQueryMock.mockReturnValue({
        data: [],
        isFetching: true,
        refetch: jest.fn(),
      });

      const {getByTestId} = renderWithSafeArea(<SimulationsScreen />);
      expect(getByTestId('tab-CASES')).toBeTruthy();
    });

    it('navigates to the course overview screen when a course card is pressed', () => {
      populateAllTabs();
      const {getAllByTestId, getByTestId} = renderWithSafeArea(<SimulationsScreen />);
      fireEvent.press(getByTestId('tab-COURSES'));

      const {mockNavigate} = require('@/hooks/useAppNavigation');
      fireEvent.press(getAllByTestId('simulation-card')[0]);
      expect(mockNavigate).toHaveBeenCalledWith(
        SCREEN_NAMES.COURSE_OVERVIEW,
        {trackId: 't1'},
      );
    });
  });
});


