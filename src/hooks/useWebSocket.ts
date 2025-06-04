import {useCallback, useRef, useState} from 'react';
import Config from 'react-native-config';

import {logger} from '@/utils/logger';

export type WebSocketStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

interface UseWebSocketOptions {
  onOpen?: () => void;
  onMessage?: (data: any) => void;
  onError?: (error: any) => void;
  onClose?: () => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
  autoConnect?: boolean;
}

interface WebSocketState {
  status: WebSocketStatus;
  lastError: Error | null;
}

export const useWebSocket = ({
  onOpen,
  onMessage,
  onError,
  onClose,
  reconnectAttempts = 3,
  reconnectInterval = 2000,
}: UseWebSocketOptions) => {
  const url = Config.WEB_SOCKET_URL || '';

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const [state, setState] = useState<WebSocketState>({
    status: 'disconnected',
    lastError: null,
  });

  const handleError = useCallback(
    (error: Error) => {
      logger.error(`WebSocket error: ${error}`);
      setState(prev => ({
        ...prev,
        status: 'error',
        lastError: error,
      }));
      onError?.(error);
    },
    [onError],
  );

  const connect = useCallback(() => {
    logger.info(`connecting, attempt: ${reconnectAttemptRef.current}`);

    if (reconnectAttemptRef.current >= reconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    try {
      setState(prev => ({...prev, status: 'connecting'}));
      socketRef.current = new WebSocket(url);

      socketRef.current.onopen = () => {
        logger.info('WebSocket connected');
        reconnectAttemptRef.current = 0;
        setState({
          status: 'connected',
          lastError: null,
        });
        onOpen?.();
      };

      socketRef.current.onmessage = event => {
        onMessage?.(event.data);
      };

      socketRef.current.onerror = event => {
        handleError(new Error('WebSocket error occurred'));
      };

      socketRef.current.onclose = () => {
        logger.info('WebSocket closed');
        setState(prev => ({...prev, status: 'disconnected'}));
        onClose?.();

        if (reconnectAttemptRef.current < reconnectAttempts) {
          reconnectAttemptRef.current += 1;
          logger.info(`Attempting reconnect: ${reconnectAttemptRef.current}`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else {
          logger.info('Max reconnection attempts reached');
        }
      };
    } catch (error) {
      handleError(
        error instanceof Error ? error : new Error('Connection failed'),
      );
      reconnectAttemptRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, reconnectInterval);
    }
  }, [
    url,
    onOpen,
    onMessage,
    onClose,
    reconnectAttempts,
    reconnectInterval,
    handleError,
  ]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setState({
      status: 'disconnected',
      lastError: null,
    });
  }, []);

  const sendAudioData = useCallback(
    (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      if (
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      ) {
        handleError(new Error('WebSocket is not connected'));
        return;
      }
      try {
        socketRef.current.send(data);
      } catch (error) {
        handleError(
          error instanceof Error ? error : new Error('Failed to send data'),
        );
      }
    },
    [handleError],
  );

  const isConnected = useCallback(() => {
    return socketRef.current?.readyState === WebSocket.OPEN;
  }, []);

  return {
    connect,
    disconnect,
    sendAudioData,
    isConnected,
    status: state.status,
    lastError: state.lastError,
    reconnectAttempt: reconnectAttemptRef.current,
  };
};
