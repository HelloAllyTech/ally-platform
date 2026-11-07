import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';

/// RN `constants/simulations.ts` `AUDIO.THRESHOLD`: a tile counts as
/// speaking (border + animated bars) above this level.
const kAudioLevelThreshold = 0.01;

/// Port of RN `SimulationAssistantScreen/components/AudioWave/useAudioLevel`:
/// while the participant is speaking (LiveKit `SpeakingChangedEvent`, RN
/// `ParticipantEvent.IsSpeakingChanged`), polls `participant.audioLevel`
/// every 100 ms (clamped to 1; a speaking participant with no measurable
/// level reads 0.1 so the border still shows); drops to 0 when they stop.
class ParticipantAudioLevel extends ChangeNotifier {
  ParticipantAudioLevel(this.participant) {
    _listener = participant.createListener()
      ..on<SpeakingChangedEvent>((event) {
        if (event.speaking) {
          _start();
        } else {
          _stop();
        }
      });
    if (participant.isSpeaking || _read() > 0) _start();
  }

  final Participant participant;
  EventsListener<ParticipantEvent>? _listener;
  Timer? _timer;
  double _level = 0;
  bool _disposed = false;

  double get level => _level;

  /// RN `ParticipantTile`: `isSpeaking = audioLevel > AUDIO.THRESHOLD`.
  bool get isSpeaking => _level > kAudioLevelThreshold;

  double _read() {
    final value = participant.audioLevel;
    return value > 0 ? math.min(value, 1.0) : 0;
  }

  void _set(double value) {
    if (_disposed || value == _level) return;
    _level = value;
    notifyListeners();
  }

  void _update() {
    final real = _read();
    _set(real > 0 ? real : 0.1);
  }

  void _start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(milliseconds: 100), (_) => _update());
    _update();
  }

  void _stop() {
    _timer?.cancel();
    _timer = null;
    _set(0);
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _listener?.dispose();
    super.dispose();
  }
}
