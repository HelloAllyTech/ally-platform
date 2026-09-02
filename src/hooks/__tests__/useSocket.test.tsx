import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';

import {useSocket} from '../useSocket';

type FakeSocket = {
  connect: jest.Mock;
  disconnect: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  emit: jest.Mock;
  removeAllListeners: jest.Mock;
  connected: boolean;
  handlers: Record<string, (...args: any[]) => void>;
};

const mockSockets: FakeSocket[] = [];

const mockMakeSocket = (): FakeSocket => {
  const socket: FakeSocket = {
    connect: jest.fn(() => {
      socket.connected = true;
    }),
    disconnect: jest.fn(() => {
      socket.connected = false;
    }),
    on: jest.fn((event: string, cb: any) => {
      socket.handlers[event] = cb;
    }),
    off: jest.fn(),
    emit: jest.fn(),
    removeAllListeners: jest.fn(),
    connected: false,
    handlers: {},
  };
  return socket;
};

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => {
    const socket = mockMakeSocket();
    mockSockets.push(socket);
    return socket;
  }),
}));

jest.mock('@/config/env', () => ({env: {API_BASE_URL: 'https://api'}}));

// `getItem` resolves on a deferred so a test can hold a connect() inside its
// token await — the window in which the old implementation lost a socket.
let mockReleaseToken: ((token: string | null) => void) | undefined;
let mockTokenDeferred = false;

jest.mock('@/utils', () => ({
  getItem: jest.fn(
    () =>
      new Promise(resolve => {
        if (mockTokenDeferred) {
          mockReleaseToken = resolve as any;
        } else {
          resolve('token');
        }
      }),
  ),
  logger: {error: jest.fn(), info: jest.fn()},
}));

jest.mock('@/utils/logger', () => ({
  logger: {error: jest.fn(), info: jest.fn()},
}));

const Test = ({onJoined}: {onJoined?: () => void}) => {
  const hook = useSocket({
    userId: 1,
    path: '/sock',
    eventCallbacks: onJoined ? ({USER_JOINED: onJoined} as any) : undefined,
  });
  return (
    <>
      <Text
        testID="connect"
        onPress={() => {
          // Deliberately not returned: handing act() a promise turns it into an
          // async act that the caller never awaits, which corrupts the renderer
          // for every later test in the file.
          void hook.connect();
        }}
      />
      <Text
        testID="disc"
        onPress={() => {
          hook.disconnect();
        }}
      />
      <Text
        testID="emit"
        onPress={() => hook.emitSocketEvent(0 as any, {a: 1})}
      />
      <Text testID="isConn">{String(hook.isConnected())}</Text>
    </>
  );
};

const flush = () => act(async () => {});

describe('useSocket', () => {
  beforeEach(() => {
    mockSockets.length = 0;
    mockTokenDeferred = false;
    mockReleaseToken = undefined;
  });

  it('connects, emits and disconnects', async () => {
    const {getByTestId} = render(<Test />);
    act(() => getByTestId('connect').props.onPress());
    await flush();

    expect(mockSockets).toHaveLength(1);
    expect(mockSockets[0].connect).toHaveBeenCalled();

    act(() => getByTestId('emit').props.onPress());
    expect(mockSockets[0].emit).toHaveBeenCalled();

    act(() => getByTestId('disc').props.onPress());
    expect(mockSockets[0].disconnect).toHaveBeenCalled();
  });

  it('opens only one socket when connect() is called twice in a row', async () => {
    const {getByTestId} = render(<Test />);
    act(() => {
      getByTestId('connect').props.onPress();
      getByTestId('connect').props.onPress();
    });
    await flush();

    // The pair of connections milliseconds apart, one of which was orphaned
    // with nothing left to close it, is the production symptom this prevents.
    expect(mockSockets).toHaveLength(1);
  });

  it('reuses the socket it already holds instead of replacing it', async () => {
    const {getByTestId} = render(<Test />);
    act(() => getByTestId('connect').props.onPress());
    await flush();
    act(() => getByTestId('connect').props.onPress());
    await flush();

    expect(mockSockets).toHaveLength(1);
    expect(mockSockets[0].disconnect).not.toHaveBeenCalled();
  });

  it('abandons a connect whose owner disconnected during the token await', async () => {
    mockTokenDeferred = true;
    const {getByTestId} = render(<Test />);
    act(() => getByTestId('connect').props.onPress());

    // Cleanup runs while the token is still in flight: at this point there is
    // no socket for disconnect() to close, so the connect must not install one.
    act(() => getByTestId('disc').props.onPress());
    await act(async () => {
      mockReleaseToken?.('token');
    });

    expect(mockSockets).toHaveLength(0);
  });

  it('still connects after more than five connect/disconnect cycles', async () => {
    const {getByTestId} = render(<Test />);
    for (let i = 0; i < 7; i++) {
      act(() => getByTestId('connect').props.onPress());
      await flush();
      act(() => getByTestId('disc').props.onPress());
    }

    // There used to be a cumulative cap of five, after which connect() was a
    // permanent no-op and the screen sat on "Connecting…" forever.
    expect(mockSockets).toHaveLength(7);
    expect(mockSockets[6].connect).toHaveBeenCalled();
  });

  it('dispatches events to the current callback, not the one bound at connect', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const {getByTestId, rerender} = render(<Test onJoined={first} />);
    act(() => getByTestId('connect').props.onPress());
    await flush();

    rerender(<Test onJoined={second} />);
    await flush();

    act(() => mockSockets[0].handlers.USER_JOINED?.({}));
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });
});
