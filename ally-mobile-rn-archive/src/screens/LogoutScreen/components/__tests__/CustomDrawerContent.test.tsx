import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {DrawerContentComponentProps} from '@react-navigation/drawer';

import {DrawerContent} from '../CustomDrawerContent';

// Mock hooks and utils
const mockNavigate = jest.fn();
jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({ t: (k: string) => k }),
  useUser: () => ({ userData: { name: 'John Doe', email: 'john.very.long.email.address@example.com' } }),
  useSimulationCredits: () => ({ credits: null, getCreditsInfo: null }),
  useAppNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
  }),
}));

jest.mock('@/store/hooks', () => ({
  __esModule: true,
  useAppSelector: () => ['start:microphone-chat'], // Mock permissions
}));

jest.mock('@/utils', () => ({
  __esModule: true,
  getAppVersion: () => '1.2.3',
}));

jest.mock('@/config/env', () => ({
  __esModule: true,
  env: { ENVIRONMENT: 'development' },
}));

jest.mock('@/services/authApi', () => ({
  __esModule: true,
  useGetLogoUrlQuery: () => ({ data: null }),
}));

// Mock child components to avoid rendering complexity
jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    UserProfileImage: () => <View testID="profile-icon" />,
  };
});

jest.mock('../MenuOption', () => {
  const React = require('react');
  const {TouchableOpacity, View, Text} = require('react-native');
  return {
    __esModule: true,
    MenuOption: ({icon, text, onPress}: any) => (
      <TouchableOpacity onPress={onPress} testID={`menu-option-${text}`}>
        {icon}
        <Text>{text}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    LogoutIcon: () => <View testID="logout-icon" />,
    ProfileIcon: () => <View testID="profile-icon" />,
    ProfileSettingsIcon: () => <View testID="profile-settings-icon" />,
    HelpIcon: () => <View testID="help-icon" />,
    BoltIcon: () => <View testID="bolt-icon" />,
    AllyLogoIcon: () => <View testID="ally-logo-icon" />,
  };
});

jest.mock('@/theme', () => ({
  __esModule: true,
  colors: {
    white: '#FFFFFF',
    black: '#000000',
    lightGray2: '#E5E5E5',
    lightGray5: '#F5F5F5',
    softCoralRed: '#FF6B6B',
    azureBlue: '#4A90E2',
    ds: {
      typography: {
        highEmphasis: '#000000',
        mediumEmphasis: '#666666',
        lowEmphasis: '#999999',
      },
      stroke: {
        primary: '#d2d2d2',
      },
      brand: {
        logo: '#4A90E2',
      },
      blue: {
        300: '#64B5F6',
        400: '#42A5F5',
      },
      amber: {
        400: '#FFCA28',
      },
      deepPurple: {
        300: '#9575cd',
      },
      orange: {
        300: '#ffb74d',
      },
      red: {
        50: '#ffd9d4',
        100: '#ffc9c1',
        200: '#ffa79c',
        300: '#fe6f64',
        400: '#f93535',
        500: '#f93535',
        600: '#a9554d',
        700: '#97413a',
        800: '#810001',
        900: '#5a0000',
        950: '#390002',
      },
      green: {
        50: '#e8f5e9',
        100: '#c8e6c9',
        200: '#a5d6a7',
        300: '#81c784',
        400: '#66bb6a',
        500: '#4caf50',
        600: '#43a047',
        700: '#388e3c',
        800: '#2e7d32',
        900: '#18441b',
      },
    },
  },
  radius: {
    full: 999,
    lg: 12,
  },
  fontFamily: {
    REPLAY_PRO: {
      HEADLINE: {fontFamily: 'ReplayPro-Headline'},
    },
    IBM_PLEX_SERIF: {
      MEDIUM: {fontFamily: 'IBMPlexSerif-Medium'},
      REGULAR: {fontFamily: 'IBMPlexSerif-Regular'},
    },
    ROBOTO: {
      REGULAR: {fontFamily: 'Roboto-Regular'},
    },
  },
  typography: {
    body: {
      large: {
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: 0.5,
      },
      small: {
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0.2,
      },
    },
    label: {
      large: {
        fontSize: 14,
        lineHeight: 22,
        letterSpacing: 0.2,
      },
    },
    headline: {
      tiny: {
        fontSize: 18,
        lineHeight: 24,
        letterSpacing: 0,
      },
    },
  },
}));

describe('CustomDrawerContent', () => {
  const mockDrawerProps: DrawerContentComponentProps = {
    state: {
      index: 0,
      routes: [],
      history: [],
      type: 'drawer' as const,
      key: 'drawer',
      stale: false,
      routeNames: [],
    } as any,
    navigation: {
      navigate: jest.fn(),
      goBack: jest.fn(),
      closeDrawer: jest.fn(),
      openDrawer: jest.fn(),
      toggleDrawer: jest.fn(),
      dispatch: jest.fn(),
      reset: jest.fn(),
      isFocused: jest.fn(() => true),
      canGoBack: jest.fn(() => false),
      getId: jest.fn(),
      getParent: jest.fn(),
      getState: jest.fn(),
      setParams: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    } as any,
    descriptors: {} as any,
  };

  it('renders user info, logout button, carousel and version in dev', () => {
    const openLogoutModal = jest.fn();
    const {getByText, getByTestId} = render(
      <DrawerContent {...mockDrawerProps} openLogoutModal={openLogoutModal} />,
    );

    expect(getByTestId('profile-icon')).toBeTruthy();
    expect(getByText('John Doe')).toBeTruthy();
    // email is long so style adjusts, but we just check it's present
    expect(getByText('john.very.long.email.address@example.com')).toBeTruthy();

    // logout button
    expect(getByTestId('logout-icon')).toBeTruthy();
    expect(getByText('user.logout')).toBeTruthy();

    // profile settings menu item
    expect(getByTestId('profile-settings-icon')).toBeTruthy();
    expect(getByText('profile.settings.title')).toBeTruthy();

    // report a problem menu item
    expect(getByTestId('help-icon')).toBeTruthy();
    expect(getByText('bugReport.menuLabel')).toBeTruthy();

    // version
    expect(getByText(/common.version/)).toBeTruthy();
    expect(getByText(/1.2.3/)).toBeTruthy();
    expect(getByText(/drawer.dev/)).toBeTruthy();
  });

  it('invokes openLogoutModal when logout is pressed', () => {
    const openLogoutModal = jest.fn();
    const {getByText} = render(
      <DrawerContent {...mockDrawerProps} openLogoutModal={openLogoutModal} />,
    );

    fireEvent.press(getByText('user.logout'));
    expect(openLogoutModal).toHaveBeenCalled();
  });

  it('navigates to BugReport and closes the drawer when "Report a problem" is pressed', () => {
    const openLogoutModal = jest.fn();
    const {getByText} = render(
      <DrawerContent {...mockDrawerProps} openLogoutModal={openLogoutModal} />,
    );

    fireEvent.press(getByText('bugReport.menuLabel'));
    expect(mockDrawerProps.navigation.closeDrawer).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('BugReport');
  });

  // Test removed as isAppFeatureEnabled function no longer exists
  // The carousel and version are now shown based on permissions only
});


