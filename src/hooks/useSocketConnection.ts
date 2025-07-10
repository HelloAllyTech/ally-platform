import {useCallback, useRef} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {AppState} from 'react-native';

import {SocketEvent} from '@/types/message';

import {useSocket} from './useSocket';

interface UseSocketConnectionOptions {
  path?: string;
  userId?: number;
  eventCallbacks?: Partial<Record<SocketEvent, (params?: any) => void>>;
  onConnect?: () => void;
  onDisconnect?: () => void;
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
 *     onConnect: () => console.log('Connected'),
 *     onDisconnect: () => console.log('Disconnected'),
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
}: UseSocketConnectionOptions) => {
  const appState = useRef(AppState.currentState);

  const {connect, disconnect, emitSocketEvent} = useSocket({
    path,
    userId,
    eventCallbacks,
  });

  // Handle screen focus/blur
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        connect();
        onConnect?.();
        const subscription = AppState.addEventListener(
          'change',
          nextAppState => {
            if (
              appState.current.match(/inactive|background/) &&
              nextAppState === 'active'
            ) {
              // App has come to foreground
              connect();
              onConnect?.();
            } else if (
              appState.current === 'active' &&
              nextAppState.match(/inactive|background/)
            ) {
              // App has gone to background
              disconnect();
              onDisconnect?.();
            }
            appState.current = nextAppState;
          },
        );
        return () => {
          disconnect();
          onDisconnect?.();
          subscription.remove();
        };
      }
    }, [connect, disconnect, onConnect, onDisconnect, userId]),
  );

  return {
    emitSocketEvent,
  };
};
