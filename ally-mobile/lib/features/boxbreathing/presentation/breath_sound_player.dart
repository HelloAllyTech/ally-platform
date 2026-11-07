import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The handful of `react-native-sound-player` calls RN's
/// `BoxBreathingAnimation` makes on `sounds.breath`, as a narrow seam so
/// widget tests can swap in a fake (same reason as
/// `SimulationAudioPlaybackController`: `audioplayers` has no fakeable
/// platform interface).
abstract class BreathSoundPlayer {
  /// RN's mount effect: `SoundPlayer.setMixAudio(true)` then
  /// `SoundPlayer.playAsset(sounds.breath)`.
  Future<void> playAsset();

  /// RN's `SoundPlayer.seek(0)` + `SoundPlayer.play()` (each Inhale, and
  /// resuming playback).
  Future<void> replay();

  Future<void> pause();

  /// RN's `SoundPlayer.setVolume(isMuted ? 0 : 1)`.
  Future<void> setVolume(double volume);

  /// RN's unmount cleanup: `SoundPlayer.stop()` (+ releasing the player).
  Future<void> stop();
}

/// The real player, backed by `audioplayers`. Every call is queued behind
/// the previous one (RN's calls are fire-and-forget too, but a `seek`
/// landing before `play(AssetSource)` finished loading would fail here)
/// and failures are swallowed: a missing sound must never break the screen.
class AudioplayersBreathSoundPlayer implements BreathSoundPlayer {
  final AudioPlayer _player = AudioPlayer();
  Future<void> _queue = Future.value();

  Future<void> _enqueue(Future<void> Function() op) {
    return _queue = _queue.then((_) => op()).catchError((Object e) {
      debugPrint('BreathSoundPlayer: $e');
    });
  }

  @override
  Future<void> playAsset() => _enqueue(() async {
    // `setMixAudio(true)`: don't take audio focus from the microphone/call
    // audio session the Scribe screen just used.
    await _player.setAudioContext(
      AudioContextConfig(focus: AudioContextConfigFocus.mixWithOthers).build(),
    );
    await _player.play(AssetSource('sounds/breath.mp3'));
  });

  @override
  Future<void> replay() => _enqueue(() async {
    await _player.seek(Duration.zero);
    await _player.resume();
  });

  @override
  Future<void> pause() => _enqueue(_player.pause);

  @override
  Future<void> setVolume(double volume) => _enqueue(() => _player.setVolume(volume));

  @override
  Future<void> stop() => _enqueue(() async {
    await _player.stop();
    await _player.dispose();
  });
}

/// How [BoxBreathingScreen] gets its player — overridden in tests.
final breathSoundPlayerFactoryProvider = Provider<BreathSoundPlayer Function()>(
  (ref) => AudioplayersBreathSoundPlayer.new,
);
