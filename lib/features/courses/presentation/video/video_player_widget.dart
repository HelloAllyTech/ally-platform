import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
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
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: Stack(
        alignment: Alignment.center,
        children: [
          VideoPlayer(_controller),
          _PlayPauseOverlay(controller: _controller),
          _ScrubBar(controller: _controller),
        ],
      ),
    );
  }
}

class _PlayPauseOverlay extends StatelessWidget {
  const _PlayPauseOverlay({required this.controller});

  final VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => controller.value.isPlaying ? controller.pause() : controller.play(),
      child: ValueListenableBuilder<VideoPlayerValue>(
        valueListenable: controller,
        builder: (context, value, _) => AnimatedOpacity(
          opacity: value.isPlaying ? 0 : 1,
          duration: const Duration(milliseconds: 150),
          child: Container(
            color: Colors.black26,
            child: Center(
              child: SvgPicture.asset('assets/icons/playWhite.svg', width: 56, height: 56),
            ),
          ),
        ),
      ),
    );
  }
}

class _ScrubBar extends StatelessWidget {
  const _ScrubBar({required this.controller});

  final VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    // `VideoProgressIndicator` listens to the controller itself; wrapping
    // it in a ValueListenableBuilder only rebuilt it a second time on every
    // ~100ms position update.
    return Align(
      alignment: Alignment.bottomCenter,
      child: VideoProgressIndicator(
        controller,
        allowScrubbing: true,
        padding: const EdgeInsets.all(8),
      ),
    );
  }
}
