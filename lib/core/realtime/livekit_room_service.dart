import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';

/// Thin wrapper around LiveKit's `Room`, mirroring exactly what
/// ally-mobile (React Native)'s `SimulationAssistantScreen.tsx` does:
/// `room.connect(liveKitServerUrl, accessToken)`, where both values come
/// from the backend's session-creation response (unchanged by this
/// rewrite — same session API, same token minting). This is the other
/// half of Phase 1 alongside [ForegroundRecordingService]/[SocketService]:
/// LiveKit's own SDK already declares background-audio support on both
/// platforms (see Flutter-Migration-Plan.pdf), which is the actual bet this
/// migration is making for live roleplay voice specifically.
class LiveKitRoomService {
  Room? _room;

  Room get room => _room ??= Room();

  bool get isConnected => _room?.connectionState == ConnectionState.connected;

  Future<void> connect({
    required String liveKitServerUrl,
    required String accessToken,
  }) async {
    await room.connect(liveKitServerUrl, accessToken);
  }

  Future<void> setMicrophoneEnabled(bool enabled) async {
    await room.localParticipant?.setMicrophoneEnabled(enabled);
  }

  Future<void> disconnect() async {
    await _room?.disconnect();
  }

  Future<void> dispose() async {
    await _room?.dispose();
    _room = null;
  }
}

final liveKitRoomServiceProvider = Provider<LiveKitRoomService>((ref) {
  final service = LiveKitRoomService();
  ref.onDispose(service.dispose);
  return service;
});
