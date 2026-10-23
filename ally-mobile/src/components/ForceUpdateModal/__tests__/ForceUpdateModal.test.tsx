import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ForceUpdateModal} from '@/components/ForceUpdateModal';

jest.mock('@/assets', () => ({
  ForceUpdateAlertIcon: () => null,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Button: ({onPress, label}: any) =>
      React.createElement(Text, {onPress}, label),
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/utils', () => ({
  openAppStore: jest.fn(),
}));

describe('ForceUpdateModal', () => {
  it('does not render when not visible', () => {
    const {queryByText} = render(<ForceUpdateModal visible={false} />);
    expect(queryByText('forceUpdate.description')).toBeNull();
  });

  it('renders and triggers openAppStore on button press', () => {
    const {getByText} = render(<ForceUpdateModal visible />);
    fireEvent.press(getByText('forceUpdate.updateButton'));
    const {openAppStore} = require('@/utils');
    expect(openAppStore).toHaveBeenCalled();
  });
});
