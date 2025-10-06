import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {CustomModal} from '@/components/CustomModal';

describe('CustomModal', () => {
  it('does not render when not visible', () => {
    const {queryByText} = render(
      <CustomModal
        visible={false}
        onClose={jest.fn()}
        title="Title"
        primaryButtonText="OK"
        secondaryButtonText="Cancel"
        onPrimaryPress={jest.fn()}
      />,
    );
    expect(queryByText('Title')).toBeNull();
  });

  it('renders title and buttons when visible', () => {
    const {getByText} = render(
      <CustomModal
        visible
        onClose={jest.fn()}
        title="Title"
        primaryButtonText="OK"
        secondaryButtonText="Cancel"
        onPrimaryPress={jest.fn()}
      />,
    );
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('OK')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
  });

  it('submits input value on primary press and closes', () => {
    const onPrimaryPress = jest.fn();
    const onClose = jest.fn();

    const {getByText, getByPlaceholderText} = render(
      <CustomModal
        visible
        onClose={onClose}
        title="Rename"
        placeholder="Name"
        initialValue="Draft"
        primaryButtonText="Save"
        secondaryButtonText="Cancel"
        onPrimaryPress={onPrimaryPress}
        showInput
      />,
    );

    fireEvent.changeText(getByPlaceholderText('Name'), 'New Name');
    fireEvent.press(getByText('Save'));

    expect(onPrimaryPress).toHaveBeenCalledWith('New Name');
    expect(onClose).toHaveBeenCalled();
  });

  it('invokes secondary press and closes', () => {
    const onSecondaryPress = jest.fn();
    const onClose = jest.fn();

    const {getByText} = render(
      <CustomModal
        visible
        onClose={onClose}
        title="Confirm"
        primaryButtonText="OK"
        secondaryButtonText="Cancel"
        onPrimaryPress={jest.fn()}
        onSecondaryPress={onSecondaryPress}
      />,
    );

    fireEvent.press(getByText('Cancel'));
    expect(onSecondaryPress).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
