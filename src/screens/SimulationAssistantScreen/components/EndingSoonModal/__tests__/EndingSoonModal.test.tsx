import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {EndingSoonModal} from '../EndingSoonModal';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));

jest.mock('@/assets/icons', () => ({
  __esModule: true,
  HourGlassIcon: () => null,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {TouchableOpacity, View, Text} = require('react-native');
  return {
    __esModule: true,
    IllustratedActionModal: ({visible, titleMain, titleItalic, description, actions}: any) =>
      visible ? (
        <View testID="illustrated-modal">
          <Text>{titleMain}</Text>
          <Text>{titleItalic}</Text>
          <Text>{description}</Text>
          <TouchableOpacity testID="action-end" onPress={actions[0].onPress}>
            <Text>{actions[0].label}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="action-continue" onPress={actions[1].onPress}>
            <Text>{actions[1].label}</Text>
          </TouchableOpacity>
        </View>
      ) : null,
  };
});

describe('EndingSoonModal', () => {
  it('renders and triggers action handlers', () => {
    const onContinue = jest.fn();
    const onEndSession = jest.fn();
    const {getByTestId, getByText} = render(
      <EndingSoonModal
        visible
        titleMain="Session"
        titleItalic="ending soon"
        description="Ends in 30s"
        onContinue={onContinue}
        onEndSession={onEndSession}
      />,
    );

    getByTestId('illustrated-modal');
    getByText('Session');
    getByText('ending soon');

    fireEvent.press(getByTestId('action-end'));
    fireEvent.press(getByTestId('action-continue'));

    expect(onEndSession).toHaveBeenCalled();
    expect(onContinue).toHaveBeenCalled();
  });
});


