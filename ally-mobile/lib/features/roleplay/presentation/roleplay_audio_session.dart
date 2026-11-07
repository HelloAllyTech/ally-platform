// LiveKit marks its audio-session option types experimental; they are the
// only way to pick RN's Android media preset.
// ignore_for_file: experimental_member_use

import 'dart:io' show Platform;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';

/// Port of RN `SimulationAssistantScreen.configureAudioSession`, run right
/// before `room.connect`:
///
/// ```ts
/// AudioSession.configureAudio({
///   android: {preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
///             audioTypeOptions: AndroidAudioTypePresets.media},
///   ios: {defaultOutput: 'speaker'},
/// });
/// ```
///
/// Without it the call can come out of the earpiece. A seam so widget tests
/// (no LiveKit/WebRTC plugin registered) can skip the native calls.
abstract class RoleplayAudioSession {
  /// Throws on failure; the screen shows RN's `errors.audioSession` and
  /// still connects, as RN does.
  Future<void> configure();
}

class LiveKitRoleplayAudioSession implements RoleplayAudioSession {
  /// WebRTC reads the Android playout attributes once, when it creates its
  /// audio device module; later `initialize` calls are ignored natively, so
  /// this only needs to run before the first role-play of the process.
  static bool _webRtcInitialized = false;

  @override
  Future<void> configure() async {
    if (Platform.isAndroid && !_webRtcInitialized) {
      _webRtcInitialized = true;
      // RN `audioTypeOptions: AndroidAudioTypePresets.media`.
      await LiveKitClient.initialize(
        initialAudioSessionOptions: const AudioSessionOptions.communication(
          android: AndroidAudioSessionConfiguration.media,
        ),
      );
    }
    // iOS `defaultOutput: 'speaker'` / Android `preferredOutputList`
    // bluetooth → headset → speaker → earpiece: the speaker is preferred,
    // but a connected headset or Bluetooth device still wins (not forced).
    await AudioManager.instance.setSpeakerOutputPreferred(true);
  }
}

/// Does nothing — the default under `flutter test`, where the LiveKit and
/// WebRTC plugins aren't registered.
class NoopRoleplayAudioSession implements RoleplayAudioSession {
  const NoopRoleplayAudioSession();

  @override
  Future<void> configure() async {}
}

final roleplayAudioSessionProvider = Provider<RoleplayAudioSession>((ref) {
  if (Platform.environment.containsKey('FLUTTER_TEST')) {
    return const NoopRoleplayAudioSession();
  }
  return LiveKitRoleplayAudioSession();
});
