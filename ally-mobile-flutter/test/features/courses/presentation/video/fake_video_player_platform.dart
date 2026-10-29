import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';

/// Minimal fake [VideoPlayerPlatform] for widget tests.
///
/// `video_player`'s real platform implementations (Android/iOS/web) talk to
/// a platform channel that doesn't exist in `flutter test` — without this,
/// `VideoPlayerController.initialize()` rejects with `UnimplementedError`
/// (the package's default placeholder instance) and every screen that uses
/// `video_player` is stuck showing its error state. `VideoPlayerPlatform` is
/// the public interface real plugins implement (`VideoPlayerPlatform.instance
/// = ...`), so implementing a test double against it — the same approach
/// the `video_player` package uses for its own tests — is the supported way
/// to exercise real controller behavior without a device.
///
/// [getPosition] advances by [positionStepMs] on every call so the widget's
/// own polling timer (`VideoPlayerWidget`'s 500ms `Timer.periodic`, which in
/// turn reads `controller.value.position` — itself only updated via the
/// real plugin's internal 100ms position-polling timer, see
/// `video_player`'s `_applyPlayPause`) observes real forward progress
/// without depending on wall-clock time; `flutter_test` runs the whole test
/// body in a fake-async zone, so advancing via `tester.pump(duration)` drives
/// both timers deterministically.
class FakeVideoPlayerPlatform extends VideoPlayerPlatform {
  FakeVideoPlayerPlatform({this.initDuration = const Duration(seconds: 100)});

  final Duration initDuration;
  final List<String> calls = [];
  final Map<int, StreamController<VideoEvent>> _streams = {};
  final Map<int, Duration> _positions = {};
  int _nextPlayerId = 0;

  /// Set true to make the create call emit an error event instead of
  /// `initialized` — exercises the widget's own `_initError` fallback path.
  bool forceInitError = false;

  /// How much [getPosition] advances per call. Defaults to 100ms to match
  /// `video_player`'s own internal position-polling cadence
  /// (`_applyPlayPause`'s `Timer.periodic(const Duration(milliseconds:
  /// 100), ...)`) — so simulated position tracks fake-elapsed time
  /// 1:1. A much larger step here (e.g. matching a *caller's* slower poll
  /// interval instead) would make every sample look like a seek to
  /// `recordWatchSample`'s continuity check (`maxPlaybackStepSeconds`),
  /// silently crediting zero watched time.
  Duration positionStepMs = const Duration(milliseconds: 100);

  @override
  Future<void> init() async {
    calls.add('init');
  }

  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
    calls.add('create');
    final id = _nextPlayerId++;
    // The real controller only subscribes to this stream *after*
    // `createWithOptions` returns (a couple of awaits later) — a plain
    // `scheduleMicrotask` here would fire before anyone is listening and a
    // broadcast stream silently drops events with no subscriber. `onListen`
    // defers the emission until the controller actually subscribes.
    late final StreamController<VideoEvent> controller;
    controller = StreamController<VideoEvent>.broadcast(
      onListen: () {
        scheduleMicrotask(() {
          if (forceInitError) {
            controller.addError(PlatformException(code: 'VideoError', message: 'fake init error'));
          } else {
            controller.add(
              VideoEvent(
                eventType: VideoEventType.initialized,
                duration: initDuration,
                size: const Size(320, 240),
              ),
            );
          }
        });
      },
    );
    _streams[id] = controller;
    _positions[id] = Duration.zero;
    return id;
  }

  @override
  Stream<VideoEvent> videoEventsFor(int playerId) => _streams[playerId]!.stream;

  @override
  Future<void> setPreventsDisplaySleepDuringVideoPlayback(int playerId, bool value) async {}

  @override
  Future<void> setMixWithOthers(bool mixWithOthers) async {}

  @override
  Future<void> play(int playerId) async {
    calls.add('play');
  }

  @override
  Future<void> pause(int playerId) async {
    calls.add('pause');
  }

  @override
  Future<void> setLooping(int playerId, bool looping) async {}

  @override
  Future<void> setVolume(int playerId, double volume) async {}

  @override
  Future<void> setPlaybackSpeed(int playerId, double speed) async {}

  @override
  Future<void> seekTo(int playerId, Duration position) async {
    _positions[playerId] = position;
  }

  @override
  Future<Duration> getPosition(int playerId) async {
    calls.add('getPosition');
    final next = (_positions[playerId] ?? Duration.zero) + positionStepMs;
    _positions[playerId] = next;
    return next;
  }

  @override
  Future<void> dispose(int playerId) async {
    calls.add('dispose');
    await _streams[playerId]?.close();
  }

  @override
  Widget buildViewWithOptions(VideoViewOptions options) => const SizedBox.shrink();
}
