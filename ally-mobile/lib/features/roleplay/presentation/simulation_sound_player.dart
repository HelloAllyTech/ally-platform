import 'dart:async';
import 'dart:io' show Platform;

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// RN `sounds.startSimulation` / `sounds.endSimulation`
/// (`src/assets/sounds/index.ts`).
enum SimulationSound {
  start('sounds/startSimulation.mp3'),
  end('sounds/endSimulation.mp3');

  const SimulationSound(this.assetPath);

  /// Relative to `assets/`, as `AssetSource` expects.
  final String assetPath;
}

/// Port of RN's `playNotificationSound` (`utils/common.ts`), which
/// `SimulationAssistantScreen` calls with `sounds.startSimulation` on mount
/// and `sounds.endSimulation` when the call ends. A narrow seam so widget
/// tests can swap in a fake (`audioplayers` has no fakeable platform
/// interface — same reason as `BreathSoundPlayer`). RN has no mute setting
/// for these sounds, so neither does this.
abstract class SimulationSoundPlayer {
  /// Fire-and-forget; never throws.
  Future<void> play(SimulationSound sound);

  /// RN `SoundPlayer.stop()`: cuts the start ringtone short once the agent
  /// first speaks (`transitionToAgentJoined`). Never throws.
  Future<void> stop();
}

/// The real player. App-lifetime (RN's `SoundPlayer` is a global
/// singleton), so the end sound keeps playing after the role-play screen
/// has been replaced by Feedback. The `AudioPlayer` is created lazily on the
/// first play.
class AudioplayersSimulationSoundPlayer implements SimulationSoundPlayer {
  AudioPlayer? _player;

  @override
  Future<void> play(SimulationSound sound) async {
    try {
      final player = _player ??= AudioPlayer();
      // RN: `SoundPlayer.setMixAudio(true)` (play alongside the live voice
      // session instead of taking audio focus from it) and, on iOS,
      // `AudioSession.configureAudio({ios: {defaultOutput: 'speaker'}})`.
      await player.setAudioContext(
        AudioContextConfig(
          route: AudioContextConfigRoute.speaker,
          focus: AudioContextConfigFocus.mixWithOthers,
        ).build(),
      );
      await player.stop();
      await player.play(AssetSource(sound.assetPath));
    } catch (e) {
      // RN: `logger.error('Failed to play notification sound: …')`.
      debugPrint('Failed to play notification sound: $e');
    }
  }

  @override
  Future<void> stop() async {
    try {
      await _player?.stop();
    } catch (_) {
      // RN: "Ignore if sound already finished".
    }
  }

  Future<void> dispose() async {
    try {
      await _player?.dispose();
    } catch (_) {}
  }
}

/// Plays nothing — the default under `flutter test`, where the
/// `audioplayers` plugin isn't registered and merely creating an
/// `AudioPlayer` reports a `MissingPluginException` that fails the test.
/// Tests that care about the sounds override [simulationSoundPlayerProvider]
/// with a recording fake.
class SilentSimulationSoundPlayer implements SimulationSoundPlayer {
  const SilentSimulationSoundPlayer();

  @override
  Future<void> play(SimulationSound sound) async {}

  @override
  Future<void> stop() async {}
}

final simulationSoundPlayerProvider = Provider<SimulationSoundPlayer>((ref) {
  if (Platform.environment.containsKey('FLUTTER_TEST')) {
    return const SilentSimulationSoundPlayer();
  }
  final player = AudioplayersSimulationSoundPlayer();
  ref.onDispose(player.dispose);
  return player;
});
