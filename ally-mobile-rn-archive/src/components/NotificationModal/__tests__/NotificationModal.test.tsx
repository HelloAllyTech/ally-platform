import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {NotificationModal} from '../NotificationModal';

jest.mock('@/assets', () => ({
  CloseIcon: 'CloseIcon',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/components', () => {
  const {Text} = require('react-native');
  return {
    Button: ({label, onPress}: any) => (
      <Text testID="primary-button" onPress={onPress}>
        {label}
      </Text>
    ),
  };
});

describe('NotificationModal', () => {
  it('returns null when not visible', () => {
    const {toJSON} = render(
      <NotificationModal visible={false} onConfirm={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders modal content when visible', () => {
    const {getByText} = render(
      <NotificationModal visible onConfirm={jest.fn()} />,
    );

    expect(getByText('learn.scenario.preStart.titleNormal')).toBeTruthy();
    expect(getByText('learn.scenario.preStart.content')).toBeTruthy();
    expect(getByText('learn.scenario.preStart.button')).toBeTruthy();
  });

  it('calls onConfirm when Start Session button is pressed', () => {
    const onConfirm = jest.fn();
    const {getByTestId} = render(
      <NotificationModal visible onConfirm={onConfirm} />,
    );

    fireEvent.press(getByTestId('primary-button'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is pressed', () => {
    const onClose = jest.fn();
    const {getByTestId} = render(
      <NotificationModal visible onConfirm={jest.fn()} onClose={onClose} />,
    );

    fireEvent.press(getByTestId('close-button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
