import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {Text, TouchableOpacity, View} from 'react-native';

import {CallEndConfirmationModal} from '../CallEndConfirmationModal';

jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    __esModule: true,
    IllustratedModal: ({visible, description, actionButtonText, onActionPress}: any) =>
      visible ? (
        <View>
          <Text>{description}</Text>
          <TouchableOpacity onPress={onActionPress}>
            <Text>{actionButtonText}</Text>
          </TouchableOpacity>
        </View>
      ) : null,
  };
});

describe('CallEndConfirmationModal', () => {
  it('renders microphone mode labels and triggers confirm', () => {
    const onConfirm = jest.fn();
    const {getByText} = render(
      <CallEndConfirmationModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
        isMicrophoneMode={true}
      />,
    );

    expect(getByText('audioCall.endDialog.content')).toBeTruthy();
    fireEvent.press(getByText('audioCall.endDialog.endSession'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('renders call mode labels', () => {
    const {getByText} = render(
      <CallEndConfirmationModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        isMicrophoneMode={false}
      />,
    );

    expect(getByText('audioCall.endDialog.content')).toBeTruthy();
    expect(getByText('listeningScreen.endCall')).toBeTruthy();
  });
});


