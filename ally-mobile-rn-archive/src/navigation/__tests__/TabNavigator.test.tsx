import React from 'react';
import {render} from '@testing-library/react-native';

import {BottomTabs} from '../TabNavigator';
import {SCREEN_NAMES, USER_PERMISSIONS} from '../../constants';

// Mock react-native-network-logger
jest.mock('react-native-network-logger', () => ({
  __esModule: true,
  default: () => null,
  startNetworkLogging: jest.fn(),
  stopNetworkLogging: jest.fn(),
}));

// Mock gesture handler and reanimated carousel
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({children}: any) => children,
}));

jest.mock('react-native-reanimated-carousel', () => {
  const React = require('react');
  const {View} = require('react-native');
  return (props: any) => <View {...props} />;
});

// Mock live audio stream
jest.mock('react-native-live-audio-stream', () => ({
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
}));

// Mock NetInfo
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() => Promise.resolve({isConnected: true})),
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

// Mock safe area insets
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// Mock Bottom Tabs Navigator
jest.mock('@react-navigation/bottom-tabs', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    createBottomTabNavigator: () => {
      const Navigator = ({children, tabBar}: any) => {
        const screens = React.Children.toArray(children) as any[];
        const routes = screens.map((child: any) => ({name: child.props.name}));
        const state = {routes, index: 0};
        const navigation = {navigate: jest.fn()};
        const tabBarElement = typeof tabBar === 'function' ? tabBar({state, navigation}) : null;
        return (
          <>
            <View testID="tab-navigator" />
            <View testID="mock-tab-bar">{tabBarElement}</View>
            {screens}
          </>
        );
      };
      const Screen = ({name}: any) => <View testID={`tab-screen-${name}`} />;
      return {Navigator, Screen};
    },
  };
});

// Mock screens to avoid heavy components
jest.mock('../../screens', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Screen = ({testID}: {testID: string}) => <View testID={testID} />;
  return {
    __esModule: true,
    CallLogScreen: () => <Screen testID="screen-call-log" />,
    CommunityScreen: () => <Screen testID="screen-community" />,
    SearchScreen: () => <Screen testID="screen-search" />,
    SimulationsScreen: () => <Screen testID="screen-learn" />,
    UserAnalyticsScreen: () => <Screen testID="screen-analytics" />,
  };
});

// Mock useUser and feature flag util
jest.mock('../../hooks/useUser', () => ({
  useUser: jest.fn(() => ({userData: null})),
}));

// Mock utils/common (no longer needed for isAppFeatureEnabled)
jest.mock('../../utils/common', () => ({
  ...jest.requireActual('../../utils/common'),
}));

jest.mock('@/services/reviewsApi', () => ({
  useGetUnreadSimulationReviewCountQuery: () => ({data: {count: 0}}),
}));

jest.mock('@/services/scribeReviewsApi', () => ({
  useGetUnreadScribeReviewCountQuery: () => ({data: {count: 0}}),
}));

// Mock API to prevent store issues
jest.mock('@/services/api', () => ({
  api: {
    reducerPath: 'api',
    reducer: jest.fn(),
    middleware: jest.fn(),
    injectEndpoints: jest.fn().mockReturnValue({
      useGetPlacesQuery: jest.fn(),
    }),
  },
}));

// Mock store hooks
jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: () => [],
}));

// Mock react-redux selectors
const mockUseSelector = jest.fn();
const mockUseDispatch = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (fn: any) => mockUseSelector(fn),
  useDispatch: () => mockUseDispatch,
  useStore: () => ({}),
}));

describe('BottomTabs (TabNavigator)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when user loading is true', () => {
    // First selector -> loading, Second -> permissions
    const selectorResults = [true, []];
    mockUseSelector.mockImplementation(() => selectorResults.shift());

    const {queryByTestId} = render(<BottomTabs />);
    expect(queryByTestId('tab-navigator')).toBeNull();
  });

  it('renders only tabs allowed by permissions', () => {
    const selectorResults = [false, [USER_PERMISSIONS.VIEW_REFERENCE_DOCUMENT, USER_PERMISSIONS.VIEW_COMMUNITY]];
    mockUseSelector.mockImplementation(() => selectorResults.shift());

    const {getByTestId, queryByTestId} = render(<BottomTabs />);

    expect(getByTestId('tab-navigator')).toBeTruthy();
    // Included tabs (only those with matching permissions)
    expect(getByTestId(`tab-screen-${SCREEN_NAMES.SEARCH}`)).toBeTruthy();
    expect(getByTestId(`tab-screen-${SCREEN_NAMES.COMMUNITY}`)).toBeTruthy();
    // Excluded tabs (no matching permissions)
    expect(queryByTestId(`tab-screen-${SCREEN_NAMES.CALL_LOG}`)).toBeNull();
    expect(queryByTestId(`tab-screen-${SCREEN_NAMES.USER_ANALYTICS}`)).toBeNull();
    expect(queryByTestId(`tab-screen-${SCREEN_NAMES.LEARN}`)).toBeNull();
  });

  // Test removed as isAppFeatureEnabled function no longer exists
  // The tab bar is now always rendered regardless of feature flags
});


