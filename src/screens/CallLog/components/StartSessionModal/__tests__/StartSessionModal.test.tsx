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
    PrimaryButton: ({onPress, label}: any) => (
      <Text onPress={onPress}>{label}</Text>
    ),
    SecurityCarousel: () => <View testID="security-carousel" />,
  };
});

describe('StartSessionModal', () => {
  it('returns null when not visible', () => {
    const {toJSON} = render(
      <StartSessionModal visible={false} onClose={jest.fn()} onListenLive={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('fires onListenLive when start button is pressed', () => {
    const onClose = jest.fn();
    const onListenLive = jest.fn();
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={onClose}
        onListenLive={onListenLive}
      />,
    );

    fireEvent.press(getByText('CallLogs.startSessionNow'));
    expect(onListenLive).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders SecurityCarousel when visible', () => {
    const {getByTestId} = render(
      <StartSessionModal visible onClose={jest.fn()} onListenLive={jest.fn()} />,
    );

    expect(getByTestId('security-carousel')).toBeTruthy();
  });
});
