import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The speeds "Listen all" offers (web `READ_ALOUD_SPEEDS`).
const debriefReadAloudSpeeds = [0.75, 1.0, 1.25];

enum DebriefReadAloudStatus { idle, loading, playing, paused, error }

/// The handful of `audioplayers` calls read-aloud makes, as a narrow seam so
/// widget tests can swap in a fake (same reason as
/// `SimulationAudioPlaybackController`: `audioplayers` has no fakeable
/// platform interface).
abstract class DebriefAudioPlayer {
  /// Fires when the current clip has played to its end.
  Stream<void> get onComplete;

  /// Fires when the platform player reports a playback failure.
  Stream<Object> get onError;

  Future<void> play(String url, {required double rate});
  Future<void> pause();
  Future<void> resume();
  Future<void> setPlaybackRate(double rate);
  Future<void> stop();
  Future<void> dispose();
}

class AudioplayersDebriefAudioPlayer implements DebriefAudioPlayer {
  AudioplayersDebriefAudioPlayer() {
    // Platform failures arrive as errors on the event stream.
    _events = _player.eventStream.listen((_) {}, onError: (Object e) => _errors.add(e));
  }

  final AudioPlayer _player = AudioPlayer();
  final _errors = StreamController<Object>.broadcast();
  late final StreamSubscription<AudioEvent> _events;

  @override
  Stream<void> get onComplete => _player.onPlayerComplete;

  @override
  Stream<Object> get onError => _errors.stream;

  @override
  Future<void> play(String url, {required double rate}) async {
    await _player.play(UrlSource(url));
    // Set after `play`: Android resets the rate when a new source loads.
    await _player.setPlaybackRate(rate);
  }

  @override
  Future<void> pause() => _player.pause();

  @override
  Future<void> resume() => _player.resume();

  @override
  Future<void> setPlaybackRate(double rate) => _player.setPlaybackRate(rate);

  @override
  Future<void> stop() => _player.stop();

  @override
  Future<void> dispose() async {
    await _events.cancel();
    await _errors.close();
    await _player.dispose();
  }
}

/// How [DebriefCards] gets its player — overridden in tests.
final debriefAudioPlayerFactoryProvider = Provider<DebriefAudioPlayer Function()>(
  (ref) => AudioplayersDebriefAudioPlayer.new,
);

/// Port of the web helpline's `useDebriefReadAloud` (v9 FR-29) for one
/// debrief: fetches each card's audio on the first tap (the server caches
/// it), plays the queue in order and keeps [current] so the cards can
/// highlight the one being read. Audio is never the only way to the
/// content: an error stops playback and the cards stay readable.
class DebriefReadAloud extends ChangeNotifier {
  DebriefReadAloud({required Future<String> Function(String section) fetchUrl, required this.createPlayer})
    : _fetchUrl = fetchUrl;

  final Future<String> Function(String section) _fetchUrl;
  final DebriefAudioPlayer Function() createPlayer;

  /// A signed link lives an hour; re-ask well before it expires (the web
  /// keeps its cached answer 30 minutes).
  static const _urlFreshFor = Duration(minutes: 30);

  DebriefReadAloudStatus _status = DebriefReadAloudStatus.idle;
  String? _current;
  double _speed = 1;
  final List<String> _queue = [];
  final Map<String, ({String url, DateTime at})> _urls = {};
  DebriefAudioPlayer? _player;
  StreamSubscription<void>? _completeSub;
  StreamSubscription<Object>? _errorSub;
  // Bumped by every play and stop, so audio that arrives late is dropped.
  int _playId = 0;
  bool _disposed = false;

  DebriefReadAloudStatus get status => _status;

  /// The card being read, as a section path (`work_on_this[0]`).
  String? get current => _current;
  double get speed => _speed;

  /// A ring on the card being read, so the eye can follow the voice.
  bool isBeingRead(String section) =>
      _current == section && _status != DebriefReadAloudStatus.idle && _status != DebriefReadAloudStatus.error;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  DebriefAudioPlayer _ensurePlayer() {
    final existing = _player;
    if (existing != null) return existing;
    final player = createPlayer();
    _completeSub = player.onComplete.listen((_) {
      if (_status == DebriefReadAloudStatus.playing) unawaited(_playNext());
    });
    _errorSub = player.onError.listen((_) => _fail());
    return _player = player;
  }

  Future<String> _urlFor(String section) async {
    final cached = _urls[section];
    if (cached != null && DateTime.now().difference(cached.at) < _urlFreshFor) return cached.url;
    final url = await _fetchUrl(section);
    _urls[section] = (url: url, at: DateTime.now());
    return url;
  }

  void _fail() {
    _queue.clear();
    _status = DebriefReadAloudStatus.error;
    _notify();
  }

  /// Read these cards in order ("Listen all"), or one card.
  void play(List<String> sections) {
    _playId++;
    unawaited(_player?.stop());
    _queue
      ..clear()
      ..addAll(sections);
    unawaited(_playNext());
  }

  Future<void> _playNext() async {
    final playId = _playId;
    if (_queue.isEmpty) {
      _current = null;
      _status = DebriefReadAloudStatus.idle;
      _notify();
      return;
    }
    final section = _queue.removeAt(0);
    _current = section;
    _status = DebriefReadAloudStatus.loading;
    _notify();
    try {
      final url = await _urlFor(section);
      // Stopped, or another play started, while the audio was on its way.
      if (_disposed || playId != _playId) return;
      await _ensurePlayer().play(url, rate: _speed);
      if (_disposed || playId != _playId) return;
      _status = DebriefReadAloudStatus.playing;
      _notify();
    } catch (_) {
      if (_disposed || playId != _playId) return;
      _fail();
    }
  }

  void pause() {
    unawaited(_player?.pause());
    _status = DebriefReadAloudStatus.paused;
    _notify();
  }

  Future<void> resume() async {
    final player = _player;
    if (player == null) return;
    try {
      await player.resume();
      _status = DebriefReadAloudStatus.playing;
      _notify();
    } catch (_) {
      _fail();
    }
  }

  void stop() {
    _playId++;
    _queue.clear();
    unawaited(_player?.stop());
    _current = null;
    _status = DebriefReadAloudStatus.idle;
    _notify();
  }

  void setSpeed(double speed) {
    _speed = speed;
    unawaited(_player?.setPlaybackRate(speed));
    _notify();
  }

  /// Leaving the debrief stops the voice.
  @override
  void dispose() {
    _disposed = true;
    _playId++;
    _completeSub?.cancel();
    _errorSub?.cancel();
    final player = _player;
    if (player != null) unawaited(player.stop().whenComplete(player.dispose));
    super.dispose();
  }
}
