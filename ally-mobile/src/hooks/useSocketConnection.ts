import {useCallback, useRef} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {AppState} from 'react-native';

import {SocketEvent} from '@/types';

import {useSocket} from './useSocket';

interface UseSocketConnectionOptions {
  path?: string;
  userId?: number;
  /**
   * Handlers for inbound socket events. The parameter is `never` rather than
   * `unknown` because parameters are contravariant: `(data: SocketMessage) =>
   * void` is not assignable to `(params?: unknown) => void`, so every caller
   * that actually typed its payload was a type error. `never` is what "any
   * single-argument handler" has to be written as.
   *
   * The payload itself is genuinely untyped — it comes off the wire — and the
   * dispatch site in `useSocket` casts once to call these. That cast is the
   * one place the unsafety lives, rather than at every call site.
   */
  eventCallbacks?: Partial<Record<SocketEvent, (params: never) => void>>;
  onConnect?: () => void;
  onDisconnect?: (reason?: string) => void;
  onConnectionError?: (error?: Error) => void;
  enabled?: boolean;
  /**
   * Whether to tear down the socket when the app is backgrounded. Default true
   * (correct for chat/list screens). Set FALSE for live mic recording: a
   * counselor's screen locking or a notification briefly backgrounding the app
   * must NOT drop the recording socket — doing so fires 'disconnect', surfaces
   * "something went wrong", and abandons the session. Kept connected, socket.io
   * buffers frames across a transient background and flushes on resume.
   * (Surviving a long-locked screen additionally needs native background-audio;
   * this only stops the app from cutting the socket itself.)
   */
  disconnectOnBackground?: boolean;
}

/**
 * A custom hook that manages socket connection lifecycle based on screen focus and app state
 *
 * This hook automatically handles:
 * - Socket connection when screen comes into focus
 * - Socket disconnection when screen loses focus
 * - Reconnection when app comes to foreground
 * - Disconnection when app goes to background
 * - Cleanup of event listeners and socket connection
 *
 * @param {UseSocketConnectionOptions} options - Configuration options for the socket connection
 * @param {number} options.userId - The ID of the user to establish the socket connection for
 * @param {Partial<Record<SocketEvent, (params: never) => void>>} [options.eventCallbacks] - Map of event types to their handlers
 * @param {() => void} [options.onConnect] - Optional callback to execute when socket connects
 * @param {() => void} [options.onDisconnect] - Optional callback to execute when socket disconnects
 *
 * @returns {{ emitSocketEvent: (event: SocketEvent, data?: any) => void }} Object containing the emitSocketEvent function
 *
 * @example
 * ```tsx
 * const MyComponent = () => {
 *   const { emitSocketEvent } = useSocketConnection({
 *     userId: 123,
 *     eventCallbacks: {
 *       [SocketEvent.MESSAGE_RECEIVED]: (data) => console.log('Message:', data),
 *     },
 *     onConnect: () => logger.log('Connected'),
 *     onDisconnect: () => logger.log('Disconnected'),
 *   });
 *
 *   return <View>...</View>;
 * };
 * ```
 */
export const useSocketConnection = ({
  path = '',
  userId,
  eventCallbacks,
  onConnect,
  onDisconnect,
  onConnectionError,
  enabled = true,
  disconnectOnBackground = true,
}: UseSocketConnectionOptions) => {
  const appState = useRef(AppState.currentState);

  const {connect, disconnect, emitSocketEvent, isConnected} = useSocket({
    path,
    userId,
    eventCallbacks,
    onDisconnect,
    onConnect,
    onConnectionError,
  });

  // Handle screen focus/blur
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      if (userId) {
        connect();
        const subscription = AppState.addEventListener(
          'change',
          nextAppState => {
            if (
              appState.current.match(/inactive|background/) &&
              nextAppState === 'active'
            ) {
              // App has come to foreground
              connect();
            } else if (
              appState.current === 'active' &&
              nextAppState.match(/inactive|background/)
            ) {
              // App has gone to background. For most screens we drop the socket
              // to save resources; for live recording we keep it so a screen
              // lock / brief app switch doesn't kill the session.
              if (disconnectOnBackground) {
                disconnect();
              }
            }
            appState.current = nextAppState;
          },
        );
        return () => {
          disconnect();
          subscription.remove();
        };
      }
    }, [connect, disconnect, userId, enabled, disconnectOnBackground]),
  );

  return {
    emitSocketEvent,
    isConnected,
  };
};
