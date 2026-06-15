import {useCallback, useRef} from 'react';
import {io, Socket} from 'socket.io-client';

import {env} from '@/config/env';
import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {SocketEvent} from '@/types';
import {getItem, logger} from '@/utils';

interface UseSocketOptions {
  path?: string;
  userId?: number;
  eventCallbacks?: Partial<Record<SocketEvent, (params?: any) => void>>;
  onConnect?: () => void;
  onDisconnect?: (reason?: string) => void;
  onConnectionError?: (error?: Error) => void;
}

export const useSocket = ({
  userId,
  eventCallbacks,
  path = '',
  onConnect,
  onDisconnect,
  onConnectionError,
}: UseSocketOptions) => {
  const socketRef = useRef<Socket | null>(null);
  const connectionAttemptsRef = useRef(0);

  const maxAttempts = 5;
  const baseUrl = env.API_BASE_URL;

  const connect = useCallback(
    async () => {
      if (!userId || connectionAttemptsRef.current >= maxAttempts) {
        logger.error('Max connection attempts reached');
        return;
      }

      try {
        const accessToken = await getItem(AsyncStorageKeys.ACCESS_TOKEN);
        if (!accessToken) {
          logger.error('No access token found for socket connection');
          return;
        }
        socketRef.current = io(`${baseUrl}${path}`, {
          path: '/socket.io',
          transports: ['websocket', 'polling'],
          auth: {
            token: accessToken,
          },
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 10000,
          forceNew: true,
          autoConnect: false,
        });

        socketRef.current.connect();

        setupDefaultListeners();
        connectionAttemptsRef.current++;
      } catch (error) {
        connectionAttemptsRef.current++;
        setTimeout(() => connect(), 2000);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId],
  );

  const setupDefaultListeners = useCallback(() => {
    if (!socketRef.current) return;

    socketRef.current.on('connect', () => {
      connectionAttemptsRef.current = 0;
      onConnect?.();
    });

    socketRef.current.on('connect_error', error => {
      onConnectionError?.(error);
      logger.error(`connect_error: Socket connection error: ${error}`);
    });

    socketRef.current.on('disconnect', reason => {
      onDisconnect?.(reason);
      logger.error(`disconnect: Socket disconnected: ${reason}`);
    });

    socketRef.current.on('error', error => {
      logger.error(`error: Socket error: ${error}`);
    });

    const callbacks = eventCallbacks || {};
    Object.entries(callbacks).forEach(([key, callback]) => {
      socketRef.current?.on(key, callback);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCallbacks]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    // Reset so the next connect() (e.g. on foreground/refocus) starts fresh.
    // Otherwise the cumulative cap permanently disables reconnection mid-session.
    connectionAttemptsRef.current = 0;
  }, []);

  const sendMessage = useCallback((message: string) => {
    if (!socketRef.current) {
      logger.error('Socket not connected');
      return;
    }
    socketRef.current.emit(SocketEvent.SEND_MESSAGE, message);
  }, []);

  const emitSocketEvent = useCallback(
    (socketEvent: SocketEvent, message: Record<string, any>) => {
      if (!socketRef.current) {
        logger.error('Socket not connected');
        return;
      }
      socketRef.current.emit(socketEvent, message);
    },
    [],
  );

  const isConnected = useCallback(() => {
    return socketRef.current?.connected || false;
  }, []);

  const setListenerForEvent = useCallback(
    (socketEvent: SocketEvent, callback: (data: any) => void) => {
      if (!socketRef.current) {
        logger.error('Socket not connected');
        return;
      }
      socketRef.current.on(socketEvent, callback);
    },
    [],
  );

  const removeIfListenerPresent = useCallback((socketEvent: SocketEvent) => {
    if (!socketRef.current) {
      logger.error('Socket not connected');
      return;
    }
    socketRef.current.off(socketEvent);
  }, []);

  return {
    connect,
    disconnect,
    sendMessage,
    isConnected,
    emitSocketEvent,
    setListenerForEvent,
    removeIfListenerPresent,
  };
};
