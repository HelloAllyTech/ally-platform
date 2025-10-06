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

jest.mock('@/constants', () => ({
  CHAT_TYPES: { EXOTEL_CONFERENCE_CHAT: 'EXOTEL', MICROPHONE_CHAT: 'MIC' },
}));

describe('StartSessionModal', () => {
  it('returns null when not visible', () => {
    const {toJSON} = render(
      <StartSessionModal visible={false} onClose={jest.fn()} onJoinCall={jest.fn()} onListenLive={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('enables single option preselect and fires onJoinCall', () => {
    const onClose = jest.fn();
    const onJoinCall = jest.fn();
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={onClose}
        enabledChatTypes={['EXOTEL'] as any}
        onJoinCall={onJoinCall}
        onListenLive={jest.fn()}
      />,
    );

    fireEvent.press(getByText('CallLogs.startSessionNow'));
    expect(onJoinCall).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
