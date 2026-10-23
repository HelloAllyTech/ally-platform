import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {IllustratedActionModal} from '@/components/IllustratedActionModal';

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Button: ({onPress, label}: any) =>
      React.createElement(Text, {onPress}, label),
  };
});

describe('IllustratedActionModal', () => {
  it('does not render when not visible', () => {
    const {queryByText} = render(
      <IllustratedActionModal
        visible={false}
        titleMain="Main"
        description="Desc"
        illustration={<Text>img</Text>}
        actions={[]}
      />,
    );
    expect(queryByText('Desc')).toBeNull();
  });

  it('renders actions and triggers handlers', () => {
    const onPrimary = jest.fn();
    const onSecondary = jest.fn();

    const {getByText} = render(
      <IllustratedActionModal
        visible
        titleMain="Main"
        description="Desc"
        illustration={<Text>img</Text>}
        actions={[
          {label: 'Secondary', onPress: onSecondary, variant: 'secondary'},
          {label: 'Primary', onPress: onPrimary},
        ]}
      />,
    );

    fireEvent.press(getByText('Secondary'));
    fireEvent.press(getByText('Primary'));

    expect(onSecondary).toHaveBeenCalled();
    expect(onPrimary).toHaveBeenCalled();
  });
});
