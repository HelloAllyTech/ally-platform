import React, {useCallback, useEffect, useState} from 'react';
import {AudioSession, LiveKitRoom, useTracks} from '@livekit/react-native';
import {Room, RoomEvent, Track} from 'livekit-client';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

// A minimal LiveKit integration screen for manual testing.
// Paste your LiveKit ws URL and access token (from ally-learn-fe create room response) and join.

export const LiveKitTestScreen: React.FC = () => {
  const [wsUrl, setWsUrl] = useState<string>(
    'wss://ally-learn-poc-dev-lbzgnlp9.livekit.cloud/',
  );
  const [token, setToken] = useState<string>('');
  const [status, setStatus] = useState<string>('Idle');
  const [error, setError] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);
  const [room] = useState<Room>(() => new Room());
  const [shouldRenderRoom, setShouldRenderRoom] = useState<boolean>(false);

  const attachRoomListeners = useCallback(() => {
    const onConnected = () => {
      setStatus('Connected');
      try {
        room.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
      } catch {
        // no-op
      }
    };
    const onDisconnected = () => setStatus('Disconnected');
    const onTrackPub = () => {};
    room
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.TrackPublished, onTrackPub);
    return () => {
      room
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.TrackPublished, onTrackPub);
    };
  }, [room]);

  useEffect(() => attachRoomListeners(), [attachRoomListeners]);

  const handleConnect = useCallback(async () => {
    try {
      setError(null);
      setStatus('Connecting');
      const isValidUrl =
        wsUrl.startsWith('wss://') || wsUrl.startsWith('ws://');
      if (!wsUrl || !token || !isValidUrl) {
        throw new Error('Missing wsUrl or token');
      }
      await AudioSession.startAudioSession();
      // Let LiveKitRoom perform the connection using props
      setShouldRenderRoom(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to connect';
      setError(message);
      setStatus('Error');
    }
  }, [token, wsUrl]);

  const handleDisconnect = useCallback(async () => {
    try {
      await room.disconnect();
    } finally {
      await AudioSession.stopAudioSession();
      setIsMicEnabled(false);
      setShouldRenderRoom(false);
    }
  }, [room]);

  const handleToggleMic = useCallback(async () => {
    try {
      const next = !isMicEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setIsMicEnabled(next);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to toggle mic';
      setError(message);
    }
  }, [isMicEnabled, room]);

  useEffect(() => {
    return () => {
      // Cleanup when leaving screen
      room.disconnect();
      AudioSession.stopAudioSession();
    };
  }, [room]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.select({ios: 'padding', android: undefined})}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.header}>LiveKit Test</Text>

          <Text style={styles.label}>LiveKit URL (wss://...)</Text>
          <TextInput
            placeholder="wss://<host>"
            value={'wss://ally-learn-poc-dev-lbzgnlp9.livekit.cloud/'}
            onChangeText={setWsUrl}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.label}>Access Token</Text>
          <TextInput
            placeholder="paste token from ally-learn-fe"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, styles.tokenInput]}
            multiline
          />

          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={handleConnect}>
              <Text style={styles.buttonText}>Connect</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.secondary]}
              onPress={handleDisconnect}>
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              style={[
                styles.button,
                isMicEnabled ? styles.danger : styles.success,
              ]}
              onPress={handleToggleMic}>
              <Text style={styles.buttonText}>
                {isMicEnabled ? 'Mute Mic' : 'Unmute Mic'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.status}>Status: {status}</Text>
          {!!error && <Text style={styles.error}>Error: {error}</Text>}

          {/* Mount LiveKitRoom only after valid URL and token are provided */}
          {shouldRenderRoom && (
            <View style={styles.roomContainer}>
              <LiveKitRoom room={room} serverUrl={wsUrl} token={token}>
                <TracksDebug />
              </LiveKitRoom>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const TracksDebug = () => {
  // Debug helper: show number of subscribed camera/audio tracks
  type TrackRefLite = {source: Track.Source};
  const tracks = useTracks([
    Track.Source.Microphone,
    Track.Source.Camera,
  ]) as TrackRefLite[];
  const audioCount = tracks.filter(
    (t: TrackRefLite) => t.source === Track.Source.Microphone,
  ).length;
  const videoCount = tracks.filter(
    (t: TrackRefLite) => t.source === Track.Source.Camera,
  ).length;

  return (
    <View style={styles.debugContainer}>
      <Text>Subscribed audio tracks: {audioCount}</Text>
      <Text>Subscribed video tracks: {videoCount}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scroll: {
    padding: '16@ms',
    gap: '12@ms',
  },
  header: {
    fontSize: '22@ms',
    fontWeight: '700',
    color: '#111',
    marginBottom: '8@ms',
  },
  label: {
    fontSize: '14@ms',
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: '10@ms',
    fontSize: '14@ms',
    color: '#111',
  },
  tokenInput: {
    minHeight: '80@ms',
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: '10@ms',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: '10@ms',
    paddingHorizontal: '16@ms',
    borderRadius: 8,
  },
  secondary: {
    backgroundColor: '#6b7280',
  },
  success: {
    backgroundColor: '#16a34a',
  },
  danger: {
    backgroundColor: '#dc2626',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  status: {
    marginTop: '8@ms',
    color: '#111',
  },
  error: {
    color: '#b91c1c',
  },
  roomContainer: {
    marginTop: '16@ms',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: '8@ms',
  },
  debugContainer: {
    gap: '4@ms',
  },
});
