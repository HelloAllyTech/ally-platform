import React from 'react';
import {render} from '@testing-library/react-native';

import {BottomTabs} from '../TabNavigator';
import {SCREEN_NAMES, USER_PERMISSIONS} from '../../constants';

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

jest.mock('../../utils/common', () => ({
  ...jest.requireActual('../../utils/common'),
  isAppFeatureEnabled: jest.fn(() => true),
}));

// Mock react-redux selectors
const mockUseSelector = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (fn: any) => mockUseSelector(fn),
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
    const selectorResults = [false, [USER_PERMISSIONS.VIEW_NAVBAR_SEARCH, USER_PERMISSIONS.VIEW_NAVBAR_COMMUNITY]];
    mockUseSelector.mockImplementation(() => selectorResults.shift());

    const {getByTestId, queryByTestId} = render(<BottomTabs />);

    expect(getByTestId('tab-navigator')).toBeTruthy();
    // Included tabs
    expect(getByTestId(`tab-screen-${SCREEN_NAMES.SEARCH}`)).toBeTruthy();
    expect(getByTestId(`tab-screen-${SCREEN_NAMES.COMMUNITY}`)).toBeTruthy();
    // Excluded tabs
    expect(queryByTestId(`tab-screen-${SCREEN_NAMES.CALL_LOG}`)).toBeNull();
    expect(queryByTestId(`tab-screen-${SCREEN_NAMES.USER_ANALYTICS}`)).toBeNull();
    expect(queryByTestId(`tab-screen-${SCREEN_NAMES.LEARN}`)).toBeNull();
  });

  it('hides custom tab bar when feature flag disabled for user', () => {
    const {useUser} = require('../../hooks/useUser');
    const {isAppFeatureEnabled} = require('../../utils/common');
    useUser.mockReturnValue({userData: {id: 1}});
    isAppFeatureEnabled.mockReturnValue(false);

    const selectorResults = [false, [USER_PERMISSIONS.VIEW_NAVBAR_SEARCH]];
    mockUseSelector.mockImplementation(() => selectorResults.shift());

    const {getByTestId} = render(<BottomTabs />);
    const tabBarWrapper = getByTestId('mock-tab-bar');
    // When hidden, wrapper renders with no children
    expect(tabBarWrapper.props.children).toBeNull();
  });
});


