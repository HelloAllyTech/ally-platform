import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {IllustratedModal} from '@/components/IllustratedModal';

jest.mock('@/assets', () => ({
  CloseIcon: () => null,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Button: ({onPress, label}: any) =>
      React.createElement(Text, {onPress}, label),
  };
});

describe('IllustratedModal', () => {
  it('does not render when not visible', () => {
    const {queryByText} = render(
      <IllustratedModal
        visible={false}
        onClose={jest.fn()}
        description="desc"
        actionButtonText="Do"
        onActionPress={jest.fn()}
        titleMain="Main"
      />,
    );
    expect(queryByText('desc')).toBeNull();
  });

  it('renders and triggers action then closes', () => {
    const onActionPress = jest.fn();
    const onClose = jest.fn();
    const {getByText} = render(
      <IllustratedModal
        visible
        onClose={onClose}
        description="desc"
        actionButtonText="Do"
        onActionPress={onActionPress}
        titleMain="Main"
        illustration={<Text>img</Text>}
      />,
    );

    fireEvent.press(getByText('Do'));
    expect(onActionPress).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
