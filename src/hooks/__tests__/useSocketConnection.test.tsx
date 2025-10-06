import React from 'react';
import {AppState, Text} from 'react-native';
import {render} from '@testing-library/react-native';
import {NavigationContainer} from '@react-navigation/native';
import {useSocketConnection} from '../useSocketConnection';

jest.mock('../useSocket', () => ({
  useSocket: () => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    emitSocketEvent: jest.fn(),
  }),
}));

jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: any, _cb: any) => ({remove: jest.fn()})) as any);

const Test = () => {
  const {emitSocketEvent} = useSocketConnection({userId: 1});
  return <Text testID="root" onPress={() => emitSocketEvent(0 as any)} />;
};

describe('useSocketConnection', () => {
  it('sets up focus handlers and returns emit function', () => {
    render(
      <NavigationContainer>
        <Test />
      </NavigationContainer>,
    );
  });
});


