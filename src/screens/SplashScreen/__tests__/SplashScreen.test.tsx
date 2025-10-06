import React from 'react';
import {render, fireEvent, act, waitFor} from '@testing-library/react-native';
import {StatusBar, TouchableOpacity, View, Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SplashScreen} from '../SplashScreen';
import {SCREEN_NAMES} from '@/constants';
import {UserRole} from '@/types';

jest.useFakeTimers();

// Mocks
const mockCheckAuth = jest.fn();
const mockUseUser = {
  checkAuth: mockCheckAuth,
  isAuthenticated: false,
  isUserLoading: false,
  userData: undefined as any,
};

const mockCheckCounselorChat = jest.fn();

jest.mock('lottie-react-native', () => {
  const React = require('react');
  const {useEffect} = React;
  const {View} = require('react-native');
  return function MockLottie(props: any) {
    useEffect(() => {
      if (props.onAnimationFinish) {
        props.onAnimationFinish();
      }
    }, []);
    return <View testID="lottie-mock" />;
  };
});

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return (props: any) => <View {...props} />;
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
  useForceUpdate: jest.fn(() => ({
    versionInfo: {isUpdateRequired: false},
  })),
  useUser: jest.fn(() => mockUseUser),
  useCounselorChat: jest.fn(() => ({
    checkCounselorChat: mockCheckCounselorChat,
  })),
  useHardwareBackPressHandler: () => {},
}));

jest.mock('@/screens/SplashScreen/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    EmailLogin: ({onOtpGenerationSuccess}: any) => (
      <View testID="email-login" onTouchEnd={() => onOtpGenerationSuccess?.('x@y.com')} />
    ),
    OtpVerification: () => <View testID="otp-verification" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View, TouchableOpacity, Text} = require('react-native');
  return {
    PrimaryButton: ({label, onPress}: any) => (
      <TouchableOpacity testID="primary-button" onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    SecurityCarousel: () => <View testID="security-carousel" />,
    ForceUpdateModal: ({visible}: any) => (
      <View testID="force-update-modal" accessibilityLabel={String(visible)} />
    ),
  };
});

describe('SplashScreen', () => {
  const navigation = {
    reset: jest.fn(),
    replace: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUser.isAuthenticated = false;
    mockUseUser.isUserLoading = false;
    mockUseUser.userData = undefined as any;
    const hooks = jest.requireMock('@/hooks');
    (hooks.useForceUpdate as jest.Mock).mockReturnValue({
      versionInfo: {isUpdateRequired: false},
    });
  });

  it('shows login button after animation finishes when unauthenticated', async () => {
    const {getByTestId, queryByTestId} = render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        <SplashScreen navigation={navigation} route={{} as any} />
      </SafeAreaProvider>,
    );

    // On animation finish, login button should appear (no update required)
    await waitFor(() => expect(getByTestId('primary-button')).toBeTruthy());

    // Tapping login shows email login content and hides button
    fireEvent.press(getByTestId('primary-button'));
    expect(getByTestId('email-login')).toBeTruthy();
    expect(queryByTestId('primary-button')).toBeNull();
  });

  it('shows ForceUpdateModal when update is required and hides login', async () => {
    (jest.requireMock('@/hooks').useForceUpdate as jest.Mock).mockReturnValue({
      versionInfo: {isUpdateRequired: true},
    });

    const {getByTestId, queryByTestId} = render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        <SplashScreen navigation={navigation} route={{} as any} />
      </SafeAreaProvider>,
    );

    // ForceUpdate visible
    expect(getByTestId('force-update-modal')).toBeTruthy();
    // Login button should not appear
    expect(queryByTestId('primary-button')).toBeNull();
  });

  it('calls checkCounselorChat for authenticated counselor', async () => {
    mockUseUser.isAuthenticated = true;
    mockUseUser.userData = {role: UserRole.COUNSELOR} as any;

    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        <SplashScreen navigation={navigation} route={{} as any} />
      </SafeAreaProvider>,
    );

    await waitFor(() => expect(mockCheckCounselorChat).toHaveBeenCalled());
  });

  it('navigates to Call Log for authenticated non-counselor', async () => {
    mockUseUser.isAuthenticated = true;
    mockUseUser.userData = {role: 'OTHER'} as any;

    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        <SplashScreen navigation={navigation} route={{} as any} />
      </SafeAreaProvider>,
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(SCREEN_NAMES.CALL_LOG));
  });

  it('updates StatusBar after animation finishes', () => {
    const setHiddenSpy = jest.spyOn(StatusBar, 'setHidden');
    const setBarStyleSpy = jest.spyOn(StatusBar, 'setBarStyle');

    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        <SplashScreen navigation={navigation} route={{} as any} />
      </SafeAreaProvider>,
    );

    // Initially hidden on mount
    expect(setHiddenSpy).toHaveBeenCalledWith(true);

    // After animation finishes, a timeout flips visibility
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(setHiddenSpy).toHaveBeenCalledWith(false);
    expect(setBarStyleSpy).toHaveBeenCalledWith('dark-content');
  });
});


