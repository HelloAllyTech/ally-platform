import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';

import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
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
///
/// Look: RN's `styles.container` card (white, 0.5 stroke border, radius 8,
/// padding 16/12, margin 0 25 16) with a blue50 32pt play button, a blue50
/// speed pill, and "mm:ss  ━━━━  mm:ss" (6pt grey200 track). Callers pass
/// RN's `containerStyle` overrides as [margin] / [verticalPadding].
class SimulationAudioPlayer extends StatefulWidget {
  const SimulationAudioPlayer({
    super.key,
    required this.audioUrl,
    this.controller,
    this.margin = const EdgeInsets.only(left: 25, right: 25, bottom: 16),
    this.verticalPadding = 16,
  });

  final String audioUrl;
  final EdgeInsets margin;
  final double verticalPadding;

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

  // RN's formatPlaybackRate: `${rate}x` (JS prints 1 and 2 without ".0").
  String _rateLabel(double rate) =>
      rate == rate.roundToDouble() ? '${rate.toInt()}x' : '${rate}x';

  static const _timeStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 10,
    color: AppColors.lowEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    final progress = _duration.inMilliseconds == 0
        ? 0.0
        : (_position.inMilliseconds / _duration.inMilliseconds).clamp(0.0, 1.0);

    return Container(
      margin: widget.margin,
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: widget.verticalPadding),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
      ),
      child: Row(
        children: [
          GestureDetector(
            key: const ValueKey('simulation-audio-player-toggle'),
            onTap: _isLoading ? null : _togglePlay,
            child: Container(
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: const BoxDecoration(color: AppColors.blue50, shape: BoxShape.circle),
              child: _isLoading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                    )
                  : SvgPicture.asset(
                      _isPlaying ? 'assets/icons/pausePlayer.svg' : 'assets/icons/playWhite.svg',
                      key: ValueKey(_isPlaying ? 'simulation-audio-player-pause' : 'simulation-audio-player-play'),
                      width: 16,
                      height: 16,
                      colorFilter: const ColorFilter.mode(AppColors.primary, BlendMode.srcIn),
                    ),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            key: const ValueKey('simulation-audio-player-rate'),
            onTap: _cyclePlaybackRate,
            child: Container(
              constraints: const BoxConstraints(minWidth: 34),
              height: 24,
              padding: const EdgeInsets.symmetric(horizontal: 6),
              alignment: Alignment.center,
              decoration: BoxDecoration(color: AppColors.blue50, borderRadius: BorderRadius.circular(12)),
              child: Text(
                _rateLabel(_rates[_rateIndex]),
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifMedium,
                  fontSize: 10,
                  color: AppColors.primary,
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Text(_formatTime(_position), style: _timeStyle),
          const SizedBox(width: 6),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) => GestureDetector(
                key: const ValueKey('simulation-audio-player-progress'),
                behavior: HitTestBehavior.opaque,
                onTapDown: (details) => _seekToFraction(details.localPosition.dx / constraints.maxWidth),
                child: SizedBox(
                  height: 20,
                  child: Stack(
                    alignment: Alignment.centerLeft,
                    children: [
                      Container(
                        height: 6,
                        decoration: BoxDecoration(
                          color: AppColors.grey200,
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                      Container(
                        height: 6,
                        width: constraints.maxWidth * progress,
                        decoration: BoxDecoration(
                          color: AppColors.primary,
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 6),
          Text(_formatTime(_duration), style: _timeStyle),
        ],
      ),
    );
  }
}
