import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import 'simulation_audio_player_controller.dart';

/// Port of ally-mobile (React Native)'s `SimulationAudioPlayer` — shown
/// only on simulation/roleplay reviews (never scribe reviews, confirmed
/// from the real app: `ScribeReviewDetailsScreen` never passes an
/// `audioUrl` at all) as a header element above the review's discussion,
/// not a persistent bottom bar. Controls match the real component exactly:
/// play/pause, tap-to-seek on a plain progress bar (no drag, no visual
/// waveform — confirmed none exists anywhere in the RN app), a playback
/// speed cycle (1x -> 1.5x -> 2x -> 2.5x), and current/duration time
/// labels. Not synced to a transcript: RN's own reviewer screen wires
/// `onProgress` to a no-op (`() => {}`) — the transcript-highlight/
/// auto-scroll sync only exists on a *different* screen (the self-debrief
/// `SimulationFeedbackScreen`), confirmed directly from source, so this
/// deliberately doesn't invent that for the reviewer flow either.
class SimulationAudioPlayer extends StatefulWidget {
  const SimulationAudioPlayer({super.key, required this.audioUrl, this.controller});

  final String audioUrl;

  /// Overridable for tests — defaults to a real [AudioPlayer]-backed
  /// controller. See `simulation_audio_player_controller.dart`'s doc
  /// comment for why this seam exists instead of faking the plugin itself.
  final SimulationAudioPlaybackController? controller;

  @override
  State<SimulationAudioPlayer> createState() => _SimulationAudioPlayerState();
}

class _SimulationAudioPlayerState extends State<SimulationAudioPlayer> {
  static const _rates = [1.0, 1.5, 2.0, 2.5];

  late final SimulationAudioPlaybackController _controller =
      widget.controller ?? RealSimulationAudioPlaybackController();

  bool _isPlaying = false;
  bool _isLoading = false;
  bool _sourceLoaded = false;
  int _rateIndex = 0;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;

  @override
  void initState() {
    super.initState();
    _controller.onPositionChanged.listen((position) {
      if (mounted) setState(() => _position = position);
    });
    _controller.onDurationChanged.listen((duration) {
      if (mounted) setState(() => _duration = duration);
    });
    _controller.onPlayerStateChanged.listen((state) {
      if (mounted) setState(() => _isPlaying = state == PlayerState.playing);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _togglePlay() async {
    if (_isPlaying) {
      await _controller.pause();
      return;
    }
    setState(() => _isLoading = true);
    try {
      if (!_sourceLoaded) {
        await _controller.setSourceUrl(widget.audioUrl);
        await _controller.setPlaybackRate(_rates[_rateIndex]);
        _sourceLoaded = true;
      }
      await _controller.resume();
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _cyclePlaybackRate() async {
    setState(() => _rateIndex = (_rateIndex + 1) % _rates.length);
    await _controller.setPlaybackRate(_rates[_rateIndex]);
  }

  Future<void> _seekToFraction(double fraction) async {
    if (_duration == Duration.zero) return;
    await _controller.seek(_duration * fraction.clamp(0.0, 1.0));
  }

  String _formatTime(Duration duration) {
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  String _rateLabel(double rate) =>
      rate == rate.roundToDouble() ? '${rate.toInt()}x' : '${rate}x';

  @override
  Widget build(BuildContext context) {
    final progress = _duration.inMilliseconds == 0
        ? 0.0
        : (_position.inMilliseconds / _duration.inMilliseconds).clamp(0.0, 1.0);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('simulation-audio-player-toggle'),
            iconSize: 36,
            padding: EdgeInsets.zero,
            onPressed: _isLoading ? null : _togglePlay,
            icon: _isLoading
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(_isPlaying ? Icons.pause_circle_filled : Icons.play_circle_filled),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LayoutBuilder(
                  builder: (context, constraints) => GestureDetector(
                    key: const ValueKey('simulation-audio-player-progress'),
                    onTapDown: (details) => _seekToFraction(
                      details.localPosition.dx / constraints.maxWidth,
                    ),
                    child: Container(
                      // An explicit width is required here: without it, a
                      // plain `Container` with no intrinsic size of its own
                      // sizes itself to its child's resulting size — and
                      // the child below (`FractionallySizedBox`) shrinks
                      // itself to `progress` of the available width, which
                      // would make the *track* shrink to match the *fill*
                      // instead of spanning the full bar underneath it.
                      width: constraints.maxWidth,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.lightGray2,
                        borderRadius: BorderRadius.circular(2),
                      ),
                      child: FractionallySizedBox(
                        alignment: Alignment.centerLeft,
                        widthFactor: progress,
                        child: Container(
                          decoration: BoxDecoration(
                            color: AppColors.primary,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  '${_formatTime(_position)} / ${_formatTime(_duration)}',
                  style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            key: const ValueKey('simulation-audio-player-rate'),
            onPressed: _cyclePlaybackRate,
            child: Text(_rateLabel(_rates[_rateIndex])),
          ),
        ],
      ),
    );
  }
}
