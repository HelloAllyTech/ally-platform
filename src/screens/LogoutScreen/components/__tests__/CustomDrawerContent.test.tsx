import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {DrawerContent} from '../CustomDrawerContent';

// Mock hooks and utils
jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({ t: (k: string) => k }),
  useUser: () => ({ userData: { name: 'John Doe', email: 'john.very.long.email.address@example.com' } }),
  useSimulationCredits: () => ({ credits: null, getCreditsInfo: null }),
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

// Mock child components and icons to avoid rendering complexity
jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    __esModule: true,
    SecurityCarousel: ({variant}: any) => (
      <View testID="security-carousel"><Text>{variant}</Text></View>
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
  };
});

describe('CustomDrawerContent', () => {
  it('renders user info, logout button, carousel and version in dev', () => {
    const openLogoutModal = jest.fn();
    const {getByText, getByTestId} = render(
      <DrawerContent openLogoutModal={openLogoutModal} />,
    );

    expect(getByTestId('profile-icon')).toBeTruthy();
    expect(getByText('John Doe')).toBeTruthy();
    // email is long so style adjusts, but we just check it's present
    expect(getByText('john.very.long.email.address@example.com')).toBeTruthy();

    // logout button
    expect(getByTestId('logout-icon')).toBeTruthy();
    expect(getByText('Logout.logout')).toBeTruthy();

    // carousel and version
    expect(getByTestId('security-carousel')).toBeTruthy();
    expect(getByText(/Common.version/)).toBeTruthy();
    expect(getByText(/1.2.3/)).toBeTruthy();
    expect(getByText(/\(Dev\)/)).toBeTruthy();
  });

  it('invokes openLogoutModal when logout is pressed', () => {
    const openLogoutModal = jest.fn();
    const {getByText} = render(<DrawerContent openLogoutModal={openLogoutModal} />);

    fireEvent.press(getByText('Logout.logout'));
    expect(openLogoutModal).toHaveBeenCalled();
  });

  // Test removed as isAppFeatureEnabled function no longer exists
  // The carousel and version are now shown based on permissions only
});


