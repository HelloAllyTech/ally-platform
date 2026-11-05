import {useCallback, useEffect, useRef} from 'react';
import {io, Socket} from 'socket.io-client';

import {env} from '@/config/env';
import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {SocketEvent} from '@/types';
import {getItem, logger} from '@/utils';

interface UseSocketOptions {
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
}

const RETRY_AFTER_FAILURE_MS = 2000;

export const useSocket = ({
  userId,
  eventCallbacks,
  path = '',
  onConnect,
  onDisconnect,
  onConnectionError,
}: UseSocketOptions) => {
  /**
   * This hook owns exactly ONE socket at a time.
   *
   * It used to own however many `connect()` happened to create: each call did
   * `socketRef.current = io(...)` with `forceNew`, so a second call orphaned the
   * first socket — still open, still holding a server-side session, with nothing
   * left pointing at it to close it. In production that showed up as connections
   * arriving in pairs milliseconds apart with only one of each pair ever
   * disconnecting, and counselors accumulating four to seven live sockets on
   * `/microphone-chat`. The scribe session that mattered was then torn down by
   * whichever of them died first.
   *
   * Two things keep that from happening now: `connect()` is idempotent (a socket
   * we already own is reused, not replaced), and every connect carries a
   * generation stamp so one that is still awaiting the access token can tell
   * that `disconnect()` has since run and abandon itself instead of installing a
   * socket nobody holds.
   */
  const socketRef = useRef<Socket | null>(null);
  const generationRef = useRef(0);
  const isConnectingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Listeners are registered once per socket but dispatch through these refs, so
   * a handler always runs the current render's callback. Binding the callbacks
   * directly froze them at whatever `connect()` had closed over — for the
   * listening screen, the very first render.
   */
  const eventCallbacksRef = useRef(eventCallbacks);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onConnectionErrorRef = useRef(onConnectionError);

  useEffect(() => {
    eventCallbacksRef.current = eventCallbacks;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onConnectionErrorRef.current = onConnectionError;
  });

  const baseUrl = env.API_BASE_URL;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const setupListeners = useCallback((socket: Socket) => {
    socket.on('connect', () => {
      onConnectRef.current?.();
    });

    socket.on('connect_error', error => {
      onConnectionErrorRef.current?.(error);
      logger.error(`connect_error: Socket connection error: ${error}`);
    });

    socket.on('disconnect', reason => {
      onDisconnectRef.current?.(reason);
      logger.error(`disconnect: Socket disconnected: ${reason}`);
    });

    socket.on('error', error => {
      logger.error(`error: Socket error: ${error}`);
    });

    Object.keys(eventCallbacksRef.current || {}).forEach(key => {
      socket.on(key, (...args: unknown[]) =>
        (
          eventCallbacksRef.current as Partial<
            Record<SocketEvent, (...args: unknown[]) => void>
          >
        )?.[key as SocketEvent]?.(...args),
      );
    });
  }, []);

  const connect = useCallback(async () => {
    if (!userId) return;

    clearRetryTimer();

    // Already ours. Never replace it — resume it if the transport dropped and
    // socket.io's own reconnection has given up, otherwise leave it alone.
    if (socketRef.current) {
      if (!socketRef.current.connected) {
        socketRef.current.connect();
      }
      return;
    }

    // A connect is already in flight; a second one would race it to the ref.
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    const generation = generationRef.current;

    try {
      const accessToken = await getItem(AsyncStorageKeys.ACCESS_TOKEN);

      // `disconnect()` ran while we were awaiting the token. Whoever asked for
      // this socket no longer wants it, and holds nothing that could close it.
      if (generation !== generationRef.current) return;

      if (!accessToken) {
        logger.error('No access token found for socket connection');
        return;
      }

      const socket = io(`${baseUrl}${path}`, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        // A plain object here is captured once and resent verbatim on every
        // reconnection attempt — automatic or via our own `connect()` below —
        // so a token that rotates while this socket is alive would otherwise
        // be replayed stale forever. A function is invoked fresh each time.
        auth: cb => {
          getItem(AsyncStorageKeys.ACCESS_TOKEN)
            .then(token => cb({token}))
            .catch(error => {
              logger.error(
                `Failed to refresh access token for socket auth: ${error}`,
              );
              cb({token: accessToken});
            });
        },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        forceNew: true,
        autoConnect: false,
      });

      socketRef.current = socket;
      setupListeners(socket);
      socket.connect();
    } catch (error) {
      logger.error(`Failed to open socket connection: ${error}`);
      if (generation !== generationRef.current) return;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        connect();
      }, RETRY_AFTER_FAILURE_MS);
    } finally {
      isConnectingRef.current = false;
    }
  }, [userId, path, baseUrl, clearRetryTimer, setupListeners]);

  const disconnect = useCallback(() => {
    // Invalidates any connect still awaiting its token, so it cannot install a
    // socket after us.
    generationRef.current += 1;
    clearRetryTimer();
    isConnectingRef.current = false;

    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, [clearRetryTimer]);

  const sendMessage = useCallback((message: string) => {
    if (!socketRef.current) {
      logger.error('Socket not connected');
      return;
    }
    socketRef.current.emit(SocketEvent.SEND_MESSAGE, message);
  }, []);

  const emitSocketEvent = useCallback(
    (socketEvent: SocketEvent, message: Record<string, unknown>) => {
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
    (socketEvent: SocketEvent, callback: (data: unknown) => void) => {
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
