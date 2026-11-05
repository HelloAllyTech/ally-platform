import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ConfirmationModal} from '../ConfirmationModal';

jest.mock('@/assets', () => ({
  CloseIcon: 'CloseIcon',
}));

jest.mock('@/components', () => {
  const {TouchableOpacity, Text} = require('react-native');
  return {
    Button: ({label, onPress, variant, isLoading}: any) => (
      <TouchableOpacity
        testID={`button-${variant || 'primary'}`}
        onPress={onPress}
        disabled={isLoading}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  title: 'Confirm Action',
  description: 'Are you sure you want to proceed?',
  confirmLabel: 'Yes',
  cancelLabel: 'No',
};

describe('ConfirmationModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when not visible', () => {
    const {toJSON} = render(
      <ConfirmationModal {...defaultProps} visible={false} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders modal content when visible', () => {
    const {getByText} = render(<ConfirmationModal {...defaultProps} />);

    expect(getByText('Confirm Action')).toBeTruthy();
    expect(getByText('Are you sure you want to proceed?')).toBeTruthy();
    expect(getByText('Yes')).toBeTruthy();
    expect(getByText('No')).toBeTruthy();
  });

  it('renders subtitle when provided', () => {
    const {getByText} = render(
      <ConfirmationModal {...defaultProps} subtitle="Important" />,
    );
    expect(getByText('Important')).toBeTruthy();
  });

  it('does not render subtitle when not provided', () => {
    const {queryByText} = render(<ConfirmationModal {...defaultProps} />);
    expect(queryByText('Important')).toBeNull();
  });

  it('renders Icon when provided', () => {
    const MockIcon = () => <></>;
    const {toJSON} = render(
      <ConfirmationModal {...defaultProps} Icon={MockIcon} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('calls onClose when close button is pressed', () => {
    const onClose = jest.fn();
    const {getByText} = render(
      <ConfirmationModal {...defaultProps} onClose={onClose} />,
    );
    fireEvent.press(getByText('No'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when confirm button is pressed', () => {
    const onConfirm = jest.fn();
    const {getByText} = render(
      <ConfirmationModal {...defaultProps} onConfirm={onConfirm} />,
    );
    fireEvent.press(getByText('Yes'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('passes confirmVariant to confirm button', () => {
    const {getByTestId} = render(
      <ConfirmationModal {...defaultProps} confirmVariant="destructive" />,
    );
    expect(getByTestId('button-destructive')).toBeTruthy();
  });

  it('passes isLoading to confirm button', () => {
    const {getByTestId} = render(
      <ConfirmationModal {...defaultProps} isLoading />,
    );
    expect(getByTestId('button-primary')).toBeTruthy();
  });
});
