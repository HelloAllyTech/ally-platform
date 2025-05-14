import {useEffect, useRef, useCallback} from 'react';
import {Socket, io} from 'socket.io-client';

import {env} from '@/config/env';
import {SocketEvent} from '@/types/message';

interface UseSocketOptions {
  userId: number;
  eventCallbacks?: Partial<Record<SocketEvent, (params?: any) => void>>;
}

export const useSocket = ({userId, eventCallbacks}: UseSocketOptions) => {
  const socketRef = useRef<Socket | null>(null);
  const connectionAttemptsRef = useRef(0);
  const maxAttempts = 5;
  const baseUrl = env.API_BASE_URL;

  const connect = useCallback(
    (chatId?: number) => {
      if (connectionAttemptsRef.current >= maxAttempts) {
        console.error('Max connection attempts reached');
        return;
      }

      try {
        socketRef.current = io(baseUrl, {
          path: '',
          transports: ['polling', 'websocket'] as const,
          auth: {
            user: {
              userId,
              // chatId: chatId || 0,
            },
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
        setTimeout(() => connect(chatId), 2000);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId],
  );

  const setupDefaultListeners = useCallback(() => {
    if (!socketRef.current) return;

    socketRef.current.on('connect', () => {
      connectionAttemptsRef.current = 0;
    });

    socketRef.current.on('connect_error', error => {
      console.error('connect_error: Socket connection error:', error);
    });

    socketRef.current.on('disconnect', reason => {
      console.error('disconnect: Socket disconnected:', reason);
    });

    socketRef.current.on('error', error => {
      console.error('error: Socket error:', error);
    });

    const callbacks = eventCallbacks || {};
    Object.entries(callbacks).forEach(([key, callback]) => {
      socketRef.current?.on(key, callback);
    });
  }, [eventCallbacks]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((message: string) => {
    if (!socketRef.current) {
      console.error('Socket not connected');
      return;
    }
    socketRef.current.emit(SocketEvent.SEND_MESSAGE, message);
  }, []);

  const emitSocketEvent = useCallback(
    (socketEvent: SocketEvent, message: Record<string, any>) => {
      if (!socketRef.current) {
        console.error('Socket not connected');
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
        console.error('Socket not connected');
        return;
      }
      socketRef.current.on(socketEvent, callback);
    },
    [],
  );

  const removeIfListenerPresent = useCallback((socketEvent: SocketEvent) => {
    if (!socketRef.current) {
      console.error('Socket not connected');
      return;
    }
    socketRef.current.off(socketEvent);
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, [disconnect]);

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
