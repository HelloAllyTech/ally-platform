import 'dart:async';

import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:video_player/video_player.dart';

import '../../../../core/localization/translate_ref.dart';

/// Port of ally-mobile (React Native)'s `VideoPlayer` — thin native video
/// playback wrapper (S3-hosted sources only — see `VideoFallbackCard` for
/// youtube/vimeo/loom). Forwards raw playhead samples and pause/end events
/// to [onProgressTime]/[onPauseOrEnd]; the caller (the item player screen)
/// owns watch-progress accounting and interjection gating, same split of
/// responsibility as the RN original.
///
/// `video_player` has no onProgress event stream (unlike
/// `react-native-video`), so this samples `controller.value.position` on a
/// 500ms timer instead — functionally equivalent, just a different
/// mechanism for the same signal. The timer only runs while the video is
/// playing (a paused video's playhead doesn't move); a controller listener
/// starts/stops it and takes one sample on pause and on a seek while
/// paused, so the caller still sees every position change.
class VideoPlayerWidget extends ConsumerStatefulWidget {
  const VideoPlayerWidget({
    super.key,
    required this.url,
    required this.onProgressTime,
    required this.onPauseOrEnd,
  });

  final String url;
  final ValueChanged<double> onProgressTime;
  final VoidCallback onPauseOrEnd;

  @override
  ConsumerState<VideoPlayerWidget> createState() => VideoPlayerWidgetState();
}

class VideoPlayerWidgetState extends ConsumerState<VideoPlayerWidget> {
  late final VideoPlayerController _controller;
  Timer? _progressPoll;
  bool _wasPlaying = false;
  Duration? _lastSampledPosition;
  bool _initError = false;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.url))
      ..initialize().then((_) {
        if (!mounted) return;
        setState(() {});
        _controller.play();
      }).catchError((_) {
        if (mounted) setState(() => _initError = true);
      });
    _controller.addListener(_onControllerValue);
  }

  /// Runs the 500ms sampler only while playing. The controller notifies
  /// on every internal position update (~100ms) while playing, so this
  /// does no sampling itself then — it only flips the timer, samples once
  /// when playback stops (the pause/end transition), and samples a seek
  /// made while paused (the only way a paused playhead moves).
  void _onControllerValue() {
    final value = _controller.value;
    if (!value.isInitialized) return;
    if (value.isPlaying) {
      _progressPoll ??= Timer.periodic(const Duration(milliseconds: 500), (_) => _poll());
    } else if (_progressPoll != null) {
      _progressPoll!.cancel();
      _progressPoll = null;
      _poll();
    } else if (value.position != _lastSampledPosition) {
      _poll();
    }
  }

  void _poll() {
    final value = _controller.value;
    if (!value.isInitialized) return;
    _lastSampledPosition = value.position;
    widget.onProgressTime(value.position.inMilliseconds / 1000);
    final isPlaying = value.isPlaying;
    if (_wasPlaying && (!isPlaying || value.isCompleted)) {
      widget.onPauseOrEnd();
    }
    _wasPlaying = isPlaying;
  }

  /// Imperative controls for the parent — needed to hard-pause on a video
  /// interjection, same as the RN screen's `videoRef.current?.pause()`.
  Future<void> pause() => _controller.pause();
  Future<void> resume() => _controller.play();

  @override
  void dispose() {
    _progressPoll?.cancel();
    _controller.removeListener(_onControllerValue);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_initError) {
      return AspectRatio(
        aspectRatio: 16 / 9,
        child: ColoredBox(
          color: Colors.black,
          child: Center(
            child: Text(
              ref.t('courses.video.loadFailed'),
              style: const TextStyle(color: Colors.white70),
            ),
          ),
        ),
      );
    }
    if (!_controller.value.isInitialized) {
      return const AspectRatio(
        aspectRatio: 16 / 9,
        child: ColoredBox(color: Colors.black, child: Center(child: CircularProgressIndicator())),
      );
    }
    // RN `styles.container`: 16:9, black, `resizeMode="contain"`.
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: ColoredBox(
        color: Colors.black,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Center(
              child: AspectRatio(
                aspectRatio: _controller.value.aspectRatio,
                child: VideoPlayer(_controller),
              ),
            ),
            NativeStyleVideoControls(
              controller: _controller,
              isFullscreen: false,
              onFullscreenPressed: _enterFullscreen,
            ),
          ],
        ),
      ),
    );
  }

  /// AVKit's fullscreen button: the same player over a black full-screen
  /// page; its close button (or back) returns to the inline player.
  void _enterFullscreen() {
    Navigator.of(context, rootNavigator: true).push(
      PageRouteBuilder<void>(
        opaque: true,
        fullscreenDialog: true,
        transitionDuration: const Duration(milliseconds: 250),
        reverseTransitionDuration: const Duration(milliseconds: 200),
        pageBuilder: (_, _, _) => _FullscreenVideoPage(controller: _controller),
        transitionsBuilder: (_, animation, _, child) => FadeTransition(opacity: animation, child: child),
      ),
    );
  }
}

class _FullscreenVideoPage extends StatelessWidget {
  const _FullscreenVideoPage({required this.controller});

  final VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('video-fullscreen-page'),
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            Center(
              child: AspectRatio(aspectRatio: controller.value.aspectRatio, child: VideoPlayer(controller)),
            ),
            NativeStyleVideoControls(
              controller: controller,
              isFullscreen: true,
              onFullscreenPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }
}

/// AVKit's elapsed/remaining labels: `m:ss`, or `h:mm:ss` past an hour.
@visibleForTesting
String formatVideoTime(Duration d) {
  final total = d.inSeconds.abs();
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = (total % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$s' : '$m:$s';
}

/// Port of RN's `controls` on react-native-video, which on iOS are the
/// system AVPlayerViewController controls: fullscreen (top-left) and mute
/// (top-right) pills, skip back 10 s / play-pause / skip forward 10 s in
/// the middle, and a scrubber with the elapsed time and the remaining time
/// ("-m:ss") under it. A tap shows/hides them; while playing they hide
/// again after 3 s, while paused they stay. SF Symbol glyphs come from
/// `CupertinoIcons`.
@visibleForTesting
class NativeStyleVideoControls extends StatefulWidget {
  const NativeStyleVideoControls({
    super.key,
    required this.controller,
    required this.isFullscreen,
    required this.onFullscreenPressed,
  });

  final VideoPlayerController controller;
  final bool isFullscreen;
  final VoidCallback onFullscreenPressed;

  @override
  State<NativeStyleVideoControls> createState() => _NativeStyleVideoControlsState();
}

class _NativeStyleVideoControlsState extends State<NativeStyleVideoControls> {
  static const _autoHide = Duration(seconds: 3);
  static const _skip = Duration(seconds: 10);

  bool _visible = true;
  Timer? _hideTimer;

  @override
  void initState() {
    super.initState();
    _scheduleHide();
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    super.dispose();
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(_autoHide, () {
      if (mounted && widget.controller.value.isPlaying) setState(() => _visible = false);
    });
  }

  void _toggleVisible() {
    setState(() => _visible = !_visible);
    if (_visible) _scheduleHide();
  }

  /// Any control press keeps the controls up for another 3 s.
  void _interact(VoidCallback action) {
    action();
    if (!_visible) setState(() => _visible = true);
    _scheduleHide();
  }

  void _togglePlay() {
    final value = widget.controller.value;
    if (value.isPlaying) {
      widget.controller.pause();
    } else {
      if (value.isCompleted) widget.controller.seekTo(Duration.zero);
      widget.controller.play();
    }
  }

  void _seekBy(Duration delta) {
    final value = widget.controller.value;
    var target = value.position + delta;
    if (target < Duration.zero) target = Duration.zero;
    if (target > value.duration) target = value.duration;
    widget.controller.seekTo(target);
  }

  void _toggleMute() {
    final muted = widget.controller.value.volume == 0;
    widget.controller.setVolume(muted ? 1 : 0);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: const Key('video-controls-tap-area'),
      behavior: HitTestBehavior.opaque,
      onTap: _toggleVisible,
      child: IgnorePointer(
        ignoring: !_visible,
        child: AnimatedOpacity(
          key: const Key('video-controls'),
          opacity: _visible ? 1 : 0,
          duration: const Duration(milliseconds: 200),
          child: ValueListenableBuilder<VideoPlayerValue>(
            valueListenable: widget.controller,
            builder: (context, value, _) => _buildControls(value),
          ),
        ),
      ),
    );
  }

  Widget _buildControls(VideoPlayerValue value) {
    final remaining = value.duration - value.position;
    final muted = value.volume == 0;
    return DecoratedBox(
      decoration: const BoxDecoration(color: Colors.black26),
      child: Stack(
        children: [
          Positioned(
            top: 8,
            left: 8,
            child: _ControlPill(
              key: const Key('video-fullscreen'),
              icon: widget.isFullscreen ? CupertinoIcons.xmark : CupertinoIcons.arrow_up_left_arrow_down_right,
              semanticLabel: widget.isFullscreen ? 'Exit full screen' : 'Full screen',
              onPressed: () => _interact(widget.onFullscreenPressed),
            ),
          ),
          Positioned(
            top: 8,
            right: 8,
            child: _ControlPill(
              key: const Key('video-mute'),
              icon: muted ? CupertinoIcons.speaker_slash_fill : CupertinoIcons.speaker_2_fill,
              semanticLabel: muted ? 'Unmute' : 'Mute',
              onPressed: () => _interact(_toggleMute),
            ),
          ),
          Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _ControlIcon(
                  key: const Key('video-skip-back'),
                  icon: CupertinoIcons.gobackward_10,
                  size: 26,
                  semanticLabel: 'Skip back 10 seconds',
                  onPressed: () => _interact(() => _seekBy(-_skip)),
                ),
                const SizedBox(width: 36),
                _ControlIcon(
                  key: const Key('video-play-pause'),
                  icon: value.isPlaying ? CupertinoIcons.pause_fill : CupertinoIcons.play_fill,
                  size: 40,
                  semanticLabel: value.isPlaying ? 'Pause' : 'Play',
                  onPressed: () => _interact(_togglePlay),
                ),
                const SizedBox(width: 36),
                _ControlIcon(
                  key: const Key('video-skip-forward'),
                  icon: CupertinoIcons.goforward_10,
                  size: 26,
                  semanticLabel: 'Skip forward 10 seconds',
                  onPressed: () => _interact(() => _seekBy(_skip)),
                ),
              ],
            ),
          ),
          Positioned(
            left: 12,
            right: 12,
            bottom: 6,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: VideoProgressIndicator(
                    widget.controller,
                    allowScrubbing: true,
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    colors: const VideoProgressColors(
                      playedColor: Colors.white,
                      bufferedColor: Colors.white38,
                      backgroundColor: Colors.white24,
                    ),
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(formatVideoTime(value.position), key: const Key('video-elapsed'), style: _timeStyle),
                    Text('-${formatVideoTime(remaining)}', key: const Key('video-remaining'), style: _timeStyle),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // System font (AVKit), tabular digits so the readout doesn't jitter.
  static const _timeStyle = TextStyle(
    fontFamily: 'CupertinoSystemText',
    fontSize: 12,
    color: Colors.white70,
    fontWeight: FontWeight.w500,
    fontFeatures: [FontFeature.tabularFigures()],
  );
}

class _ControlIcon extends StatelessWidget {
  const _ControlIcon({
    super.key,
    required this.icon,
    required this.size,
    required this.semanticLabel,
    required this.onPressed,
  });

  final IconData icon;
  final double size;
  final String semanticLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      excludeSemantics: true,
      onTap: onPressed,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(icon, size: size, color: Colors.white),
        ),
      ),
    );
  }
}

/// AVKit's small translucent rounded buttons in the top corners.
class _ControlPill extends StatelessWidget {
  const _ControlPill({super.key, required this.icon, required this.semanticLabel, required this.onPressed});

  final IconData icon;
  final String semanticLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      excludeSemantics: true,
      onTap: onPressed,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onPressed,
        child: Container(
          width: 32,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: Colors.black38, borderRadius: BorderRadius.circular(14)),
          child: Icon(icon, size: 15, color: Colors.white),
        ),
      ),
    );
  }
}
