import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';

import {useSocket} from '../useSocket';

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connected: true,
  })),
}));

jest.mock('@/config/env', () => ({env: {API_BASE_URL: 'https://api'}}));
jest.mock('@/utils', () => ({
  getItem: jest.fn(async () => 'token'),
  logger: {error: jest.fn()},
}));

const Test = () => {
  const hook = useSocket({userId: 1, path: '/sock'});
  return (
    <>
      <Text testID="connect" onPress={() => hook.connect()} />
      <Text testID="emit" onPress={() => hook.emitSocketEvent(0 as any, {a: 1})} />
      <Text testID="send" onPress={() => hook.sendMessage('hi')} />
      <Text testID="disc" onPress={() => hook.disconnect()} />
      <Text testID="isConn">{String(hook.isConnected())}</Text>
    </>
  );
};

describe('useSocket', () => {
  it('connects, emits, sends, and disconnects', async () => {
    const {getByTestId} = render(<Test />);
    act(() => {
      getByTestId('connect').props.onPress();
      getByTestId('emit').props.onPress();
      getByTestId('send').props.onPress();
      getByTestId('disc').props.onPress();
    });
  });
});


