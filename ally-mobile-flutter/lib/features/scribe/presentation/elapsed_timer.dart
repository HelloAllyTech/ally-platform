import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/theme/app_fonts.dart';

/// Direct port of RN's `Timer` (`src/screens/ListeningScreen/components/
/// Timer/Timer.tsx`) — ticks every second from a fixed epoch anchor
/// ([startTime], RN's `chatData.startedAt`), formatted `HH:MM:SS` (three
/// segments — unlike `roleplay_voice_screen.dart`'s `_formatDuration`,
/// which is `MM:SS` only, since a roleplay sim is capped well under an
/// hour but a recording session isn't).
///
/// Deliberately has no pause/resume awareness, matching RN exactly: pausing
/// only stops sending audio (see `scribe_recording_screen.dart`), not the
/// session clock.
class ElapsedTimer extends StatefulWidget {
  const ElapsedTimer({super.key, required this.startTime, this.now = DateTime.now});

  final DateTime startTime;

  /// Injectable clock, same pattern as `roleplay_voice_screen.dart`'s
  /// `now` — lets tests assert on a specific elapsed duration without a
  /// real wall-clock wait.
  final DateTime Function() now;

  @override
  State<ElapsedTimer> createState() => _ElapsedTimerState();
}

class _ElapsedTimerState extends State<ElapsedTimer> {
  Timer? _timer;
  Duration _elapsed = Duration.zero;

  @override
  void initState() {
    super.initState();
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  void _tick() {
    final now = widget.now();
    final elapsed = now.isAfter(widget.startTime) ? now.difference(widget.startTime) : Duration.zero;
    if (mounted) setState(() => _elapsed = elapsed);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    String pad(int n) => n.toString().padLeft(2, '0');
    final hours = _elapsed.inHours;
    final minutes = _elapsed.inMinutes.remainder(60);
    final seconds = _elapsed.inSeconds.remainder(60);
    // RN `Timer` styles.timer: Plex Regular 16 / 20.8, white, centred.
    return Text(
      '${pad(hours)}:${pad(minutes)}:${pad(seconds)}',
      textAlign: TextAlign.center,
      style: const TextStyle(
        fontFamily: AppFonts.ibmPlexSerifRegular,
        fontSize: 16,
        height: 20.8 / 16,
        letterSpacing: 0,
        color: Colors.white,
      ),
    );
  }
}
