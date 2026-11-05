import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {LogoutModal} from '../LogoutModal';

// Mock hooks used by the component
jest.mock('@/hooks', () => {
  const handleUserLogout = jest.fn();
  return {
    __esModule: true,
    useTranslate: () => ({
      t: (key: string) => key,
    }),
    useUser: () => ({
      handleUserLogout,
    }),
    // exposed for assertions
    handleUserLogout,
  } as any;
});

// Mock child components used by the component
jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    __esModule: true,
    IllustratedModal: ({
      visible,
      description,
      actionButtonText,
      onActionPress,
      onClose,
    }: any) =>
      visible ? (
        <View testID="illustrated-modal">
          <Text>{description}</Text>
          <TouchableOpacity testID="action-button" onPress={onActionPress}>
            <Text>{actionButtonText}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="close-button" onPress={onClose}>
            <Text>close</Text>
          </TouchableOpacity>
        </View>
      ) : null,
  };
});

describe('LogoutModal', () => {
  it('does not render when not visible', () => {
    const {queryByTestId} = render(
      <LogoutModal isLogoutModalVisible={false} setIsLogoutModalVisible={jest.fn()} />,
    );
    expect(queryByTestId('illustrated-modal')).toBeNull();
  });

  it('calls logout and closes on confirm', () => {
    const setIsLogoutModalVisible = jest.fn();
    const {getByTestId} = render(
      <LogoutModal isLogoutModalVisible setIsLogoutModalVisible={setIsLogoutModalVisible} />,
    );

    const {handleUserLogout} = require('@/hooks');

    fireEvent.press(getByTestId('action-button'));

    expect(handleUserLogout).toHaveBeenCalled();
    expect(setIsLogoutModalVisible).toHaveBeenCalledWith(false);
  });

  it('closes on cancel', () => {
    const setIsLogoutModalVisible = jest.fn();
    const {getByTestId} = render(
      <LogoutModal isLogoutModalVisible setIsLogoutModalVisible={setIsLogoutModalVisible} />,
    );

    fireEvent.press(getByTestId('close-button'));

    expect(setIsLogoutModalVisible).toHaveBeenCalledWith(false);
  });
});


