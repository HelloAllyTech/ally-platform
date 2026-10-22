import 'dart:async';

import 'package:audioplayers/audioplayers.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/simulation_audio_player_controller.dart';

/// Fake for [SimulationAudioPlaybackController] — `audioplayers` has no
/// platform-interface seam to fake directly, so this stands in for the
/// real plugin entirely and lets a test drive position/duration/state
/// changes and assert on which calls the widget made, without touching a
/// method channel at all.
class FakeSimulationAudioPlaybackController
    implements SimulationAudioPlaybackController {
  final _positionController = StreamController<Duration>.broadcast();
  final _durationController = StreamController<Duration>.broadcast();
  final _stateController = StreamController<PlayerState>.broadcast();

  String? sourceUrl;
  double? lastPlaybackRate;
  Duration? lastSeek;
  int resumeCalls = 0;
  int pauseCalls = 0;
  bool disposed = false;

  @override
  Stream<Duration> get onPositionChanged => _positionController.stream;

  @override
  Stream<Duration> get onDurationChanged => _durationController.stream;

  @override
  Stream<PlayerState> get onPlayerStateChanged => _stateController.stream;

  @override
  Future<void> setSourceUrl(String url) async {
    sourceUrl = url;
  }

  @override
  Future<void> resume() async {
    resumeCalls++;
    _stateController.add(PlayerState.playing);
  }

  @override
  Future<void> pause() async {
    pauseCalls++;
    _stateController.add(PlayerState.paused);
  }

  @override
  Future<void> seek(Duration position) async {
    lastSeek = position;
  }

  @override
  Future<void> setPlaybackRate(double rate) async {
    lastPlaybackRate = rate;
  }

  @override
  Future<void> dispose() async {
    disposed = true;
    await _positionController.close();
    await _durationController.close();
    await _stateController.close();
  }

  void emitPosition(Duration position) => _positionController.add(position);
  void emitDuration(Duration duration) => _durationController.add(duration);
}
