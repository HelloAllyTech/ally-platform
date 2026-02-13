import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {StartSessionModal} from '@/screens/CallLog/components/StartSessionModal/StartSessionModal';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/assets', () => ({ CloseIcon: () => null }));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text, View} = require('react-native');
  return {
    Button: ({onPress, label}: any) => (
      <Text onPress={onPress}>{label}</Text>
    ),
    SecurityCarousel: () => <View testID="security-carousel" />,
    NotificationModal: ({visible, onConfirm}: any) =>
      visible ? (
        <View testID="notification-modal">
          <Text>Before you get started</Text>
          <Text onPress={onConfirm}>Start Session</Text>
        </View>
      ) : null,
  };
});

describe('StartSessionModal', () => {
  it('returns null when not visible', () => {
    const {toJSON} = render(
      <StartSessionModal visible={false} onClose={jest.fn()} onListenLive={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('shows notification modal when start button is pressed', () => {
    const {getByText, getByTestId} = render(
      <StartSessionModal visible onClose={jest.fn()} onListenLive={jest.fn()} />,
    );

    fireEvent.press(getByText('CallLogs.startSessionNow'));
    expect(getByTestId('notification-modal')).toBeTruthy();
    expect(getByText('Before you get started')).toBeTruthy();
    expect(getByText('Start Session')).toBeTruthy();
  });

  it('fires onListenLive when Start Session button is pressed after notification', () => {
    const onClose = jest.fn();
    const onListenLive = jest.fn();
    const {getByText} = render(
      <StartSessionModal visible onClose={onClose} onListenLive={onListenLive} />,
    );

    fireEvent.press(getByText('CallLogs.startSessionNow'));
    fireEvent.press(getByText('Start Session'));
    expect(onListenLive).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not fire onListenLive immediately when start button is pressed', () => {
    const onListenLive = jest.fn();
    const {getByText} = render(
      <StartSessionModal visible onClose={jest.fn()} onListenLive={onListenLive} />,
    );

    fireEvent.press(getByText('CallLogs.startSessionNow'));
    expect(onListenLive).not.toHaveBeenCalled();
  });

  it('closes notification modal when pressing outside (via onClose)', () => {
    const onListenLive = jest.fn();
    const {getByText, getByTestId} = render(
      <StartSessionModal visible onClose={jest.fn()} onListenLive={onListenLive} />,
    );

    fireEvent.press(getByText('CallLogs.startSessionNow'));
    expect(getByTestId('notification-modal')).toBeTruthy();
    expect(onListenLive).not.toHaveBeenCalled();
  });

  it('renders SecurityCarousel when visible', () => {
    const {getByTestId} = render(
      <StartSessionModal visible onClose={jest.fn()} onListenLive={jest.fn()} />,
    );

    expect(getByTestId('security-carousel')).toBeTruthy();
  });
});

