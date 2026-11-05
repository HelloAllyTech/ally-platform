import 'package:audioplayers/audioplayers.dart';

/// Thin seam between [SimulationAudioPlayer] and the real `audioplayers`
/// plugin — `audioplayers` has no fakeable platform-interface the way
/// `permission_handler`/`record` do in this codebase's other tests, so
/// this narrow interface (just the handful of calls/streams the widget
/// actually uses) is what a test substitutes a fake for instead, same
/// spirit as this app's other injected-for-testability seams
/// (`SocketService`, the various repositories).
abstract class SimulationAudioPlaybackController {
  Stream<Duration> get onPositionChanged;
  Stream<Duration> get onDurationChanged;
  Stream<PlayerState> get onPlayerStateChanged;

  Future<void> setSourceUrl(String url);
  Future<void> resume();
  Future<void> pause();
  Future<void> seek(Duration position);
  Future<void> setPlaybackRate(double rate);
  Future<void> dispose();
}

class RealSimulationAudioPlaybackController
    implements SimulationAudioPlaybackController {
  final AudioPlayer _player = AudioPlayer();

  @override
  Stream<Duration> get onPositionChanged => _player.onPositionChanged;

  @override
  Stream<Duration> get onDurationChanged => _player.onDurationChanged;

  @override
  Stream<PlayerState> get onPlayerStateChanged => _player.onPlayerStateChanged;

  @override
  Future<void> setSourceUrl(String url) => _player.setSourceUrl(url);

  @override
  Future<void> resume() => _player.resume();

  @override
  Future<void> pause() => _player.pause();

  @override
  Future<void> seek(Duration position) => _player.seek(position);

  @override
  Future<void> setPlaybackRate(double rate) => _player.setPlaybackRate(rate);

  @override
  Future<void> dispose() => _player.dispose();
}
