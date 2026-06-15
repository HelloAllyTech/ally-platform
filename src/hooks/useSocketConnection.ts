import {useCallback, useRef} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {AppState} from 'react-native';

import {SocketEvent} from '@/types';

import {useSocket} from './useSocket';

interface UseSocketConnectionOptions {
  path?: string;
  userId?: number;
  eventCallbacks?: Partial<Record<SocketEvent, (params?: any) => void>>;
  onConnect?: () => void;
  onDisconnect?: (reason?: string) => void;
  onConnectionError?: (error?: Error) => void;
  enabled?: boolean;
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
 * @param {Partial<Record<SocketEvent, (params?: any) => void>>} [options.eventCallbacks] - Map of event types to their handlers
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
              // App has gone to background
              disconnect();
            }
            appState.current = nextAppState;
          },
        );
        return () => {
          disconnect();
          subscription.remove();
        };
      }
    }, [connect, disconnect, userId, enabled]),
  );

  return {
    emitSocketEvent,
    isConnected,
  };
};
