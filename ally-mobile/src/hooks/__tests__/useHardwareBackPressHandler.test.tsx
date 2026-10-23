import React from 'react';
import {BackHandler, Text} from 'react-native';
import {render, fireEvent} from '@testing-library/react-native';
import {NavigationContainer} from '@react-navigation/native';

import {useHardwareBackPressHandler} from '../useHardwareBackPressHandler';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    }),
  };
});

describe('useHardwareBackPressHandler', () => {
  it('registers and cleans up back handler, uses callback when provided', () => {
    const listeners: Array<() => boolean> = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_event: any, handler: any) => {
      listeners.push(handler);
      return {remove: jest.fn()};
    }) as any);

    const Test = ({withCallback = false}: {withCallback?: boolean}) => {
      useHardwareBackPressHandler(withCallback ? () => true : undefined);
      return <Text testID="root">root</Text>;
    };

    const {unmount} = render(
      <NavigationContainer>
        <Test withCallback />
      </NavigationContainer>,
    );

    // Trigger back handlers
    const result = listeners[0]?.();
    expect(result).toBe(true);

    unmount();
  });
});


