import {useCallback, useEffect, useState} from 'react';
import {AudioSession} from '@livekit/react-native';
import {Room, RoomEvent} from 'livekit-client';

interface UseLiveKitConnectionOptions {
  wsUrl: string;
  token: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: string) => void;
}

interface UseLiveKitConnectionReturn {
  room: Room;
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  isMicEnabled: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMic: () => Promise<void>;
  shouldRenderRoom: boolean;
}

export const useLiveKitConnection = ({
  wsUrl,
  token,
  onConnected,
  onDisconnected,
  onError,
}: UseLiveKitConnectionOptions): UseLiveKitConnectionReturn => {
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);
  const [room] = useState<Room>(() => new Room());
  const [shouldRenderRoom, setShouldRenderRoom] = useState<boolean>(false);

  const attachRoomListeners = useCallback(() => {
    const handleConnected = () => {
      setStatus('connected');
      setError(null);
      try {
        room.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
      } catch {
        // no-op
      }
      onConnected?.();
    };

    const handleDisconnected = () => {
      setStatus('disconnected');
      setIsMicEnabled(false);
      onDisconnected?.();
    };

    const handleTrackPublished = () => {
      // Handle track published events if needed
    };

    room
      .on(RoomEvent.Connected, handleConnected)
      .on(RoomEvent.Disconnected, handleDisconnected)
      .on(RoomEvent.TrackPublished, handleTrackPublished);

    return () => {
      room
        .off(RoomEvent.Connected, handleConnected)
        .off(RoomEvent.Disconnected, handleDisconnected)
        .off(RoomEvent.TrackPublished, handleTrackPublished);
    };
  }, [room, onConnected, onDisconnected]);

  useEffect(() => {
    return attachRoomListeners();
  }, [attachRoomListeners]);

  const connect = useCallback(async () => {
    try {
      setError(null);
      setStatus('connecting');

      const isValidUrl =
        wsUrl.startsWith('wss://') || wsUrl.startsWith('ws://');
      if (!wsUrl || !token || !isValidUrl) {
        throw new Error('Invalid WebSocket URL or missing token');
      }

      await AudioSession.startAudioSession();
      setShouldRenderRoom(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to connect';
      setError(message);
      setStatus('error');
      onError?.(message);
    }
  }, [wsUrl, token, onError]);

  const disconnect = useCallback(async () => {
    try {
      await room.disconnect();
    } catch (e) {
      // Handle disconnect errors silently
    } finally {
      await AudioSession.stopAudioSession();
      setIsMicEnabled(false);
      setShouldRenderRoom(false);
      setStatus('disconnected');
    }
  }, [room]);

  const toggleMic = useCallback(async () => {
    try {
      const next = !isMicEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setIsMicEnabled(next);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Failed to toggle microphone';
      setError(message);
      onError?.(message);
    }
  }, [isMicEnabled, room, onError]);

  useEffect(() => {
    return () => {
      // Cleanup when hook unmounts
      room.disconnect();
      AudioSession.stopAudioSession();
    };
  }, [room]);

  return {
    room,
    status,
    isMicEnabled,
    error,
    connect,
    disconnect,
    toggleMic,
    shouldRenderRoom,
  };
};
