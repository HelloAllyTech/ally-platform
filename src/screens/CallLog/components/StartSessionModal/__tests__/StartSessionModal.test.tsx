import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {StartSessionModal} from '@/screens/CallLog/components/StartSessionModal/StartSessionModal';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/assets', () => ({ CloseIcon: () => null, conversation: 1 }));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    PrimaryButton: ({onPress, label}: any) => (
      <Text onPress={onPress}>{label}</Text>
    ),
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
});
