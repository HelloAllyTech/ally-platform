import React from 'react';
import {AppState, Text} from 'react-native';
import {render, act} from '@testing-library/react-native';
import {NavigationContainer} from '@react-navigation/native';
import {useSocketConnection} from '../useSocketConnection';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../useSocket', () => ({
  useSocket: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    emitSocketEvent: jest.fn(),
    isConnected: true,
  }),
}));

// Capture the AppState 'change' listener so tests can drive fore/background.
let appStateCb: ((s: string) => void) | undefined;
jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation(((_e: any, cb: any) => {
    appStateCb = cb;
    return {remove: jest.fn()};
  }) as any);

const Test = ({disconnectOnBackground}: {disconnectOnBackground?: boolean}) => {
  useSocketConnection({userId: 1, disconnectOnBackground});
  return <Text testID="root" />;
};

const renderHook = (disconnectOnBackground?: boolean) =>
  render(
    <NavigationContainer>
      <Test disconnectOnBackground={disconnectOnBackground} />
    </NavigationContainer>,
  );

describe('useSocketConnection', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    appStateCb = undefined;
    (AppState as any).currentState = 'active';
  });

  it('sets up focus handlers and connects on focus', () => {
    renderHook();
    expect(mockConnect).toHaveBeenCalled();
    expect(typeof appStateCb).toBe('function');
  });

  it('disconnects when backgrounded by default', () => {
    renderHook();
    mockDisconnect.mockClear();
    act(() => appStateCb?.('background'));
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('does NOT disconnect on background when disconnectOnBackground=false (recording)', () => {
    renderHook(false);
    mockDisconnect.mockClear();
    act(() => appStateCb?.('background'));
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
