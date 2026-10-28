import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../theme/app_colors.dart';

/// Builds the controller for [CoverVideoPreview] — injectable so tests can
/// count/fake controllers.
typedef CoverVideoControllerFactory = VideoPlayerController Function(Uri url);

VideoPlayerController _networkController(Uri url) => VideoPlayerController.networkUrl(url);

/// Port of ally-mobile (React Native)'s `components/VideoPreview` — a
/// scenario's `coverVideoUrl` shown in place of its cover image: full
/// width, 180 tall, radius 8, black; a spinner over a smoky overlay until
/// the first frame is ready, then a white play disc. Tap to play (looping,
/// sound on, as RN's defaults), tap again to pause.
///
/// The controller is created when this widget mounts (RN's `<Video>`
/// starts loading on mount too) and disposed with it. It pauses when
/// [shouldPause] turns true or its route stops being the current one (RN's
/// `shouldPause={!isFocused}`). If the video can't be loaded,
/// [thumbnailUrl] is shown instead (when given).
class CoverVideoPreview extends StatefulWidget {
  const CoverVideoPreview({
    super.key,
    required this.url,
    this.thumbnailUrl,
    this.autoPlay = false,
    this.muted = false,
    this.shouldPause = false,
    this.height = 180,
    this.controllerFactory = _networkController,
  });

  final String url;
  final String? thumbnailUrl;
  final bool autoPlay;
  final bool muted;
  final bool shouldPause;
  final double height;
  final CoverVideoControllerFactory controllerFactory;

  @override
  State<CoverVideoPreview> createState() => _CoverVideoPreviewState();
}

class _CoverVideoPreviewState extends State<CoverVideoPreview> {
  VideoPlayerController? _controller;
  late bool _isPlaying = widget.autoPlay;
  bool _isLoading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    final controller = widget.controllerFactory(Uri.parse(widget.url));
    _controller = controller;
    try {
      await controller.initialize();
      await controller.setLooping(true);
      await controller.setVolume(widget.muted ? 0 : 1);
      if (!mounted || _controller != controller) return;
      setState(() => _isLoading = false);
      _applyPlayState();
    } catch (_) {
      if (!mounted || _controller != controller) return;
      setState(() {
        _isLoading = false;
        _failed = true;
      });
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // RN pauses on blur; a covered route is Flutter's blur.
    final isCurrent = ModalRoute.of(context)?.isCurrent ?? true;
    if (!isCurrent) _pause();
  }

  @override
  void didUpdateWidget(CoverVideoPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.shouldPause && !oldWidget.shouldPause) _pause();
    if (widget.url != oldWidget.url) {
      final old = _controller;
      _controller = null;
      old?.dispose();
      setState(() {
        _isLoading = true;
        _failed = false;
        _isPlaying = widget.autoPlay;
      });
      _initialize();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    _controller = null;
    super.dispose();
  }

  void _applyPlayState() {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    if (_isPlaying) {
      controller.play();
    } else {
      controller.pause();
    }
  }

  void _pause() {
    if (!_isPlaying) return;
    if (mounted) setState(() => _isPlaying = false);
    _applyPlayState();
  }

  void _play() {
    setState(() => _isPlaying = true);
    _applyPlayState();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final thumbnail = widget.thumbnailUrl;
    Widget content;
    if (_failed && thumbnail != null && thumbnail.isNotEmpty) {
      content = Image.network(
        thumbnail,
        key: const Key('cover-video-preview-thumbnail'),
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => const ColoredBox(color: Colors.black),
      );
    } else {
      content = Stack(
        fit: StackFit.expand,
        children: [
          if (controller != null && controller.value.isInitialized)
            // resizeMode="cover".
            FittedBox(
              fit: BoxFit.cover,
              clipBehavior: Clip.hardEdge,
              child: SizedBox(
                width: controller.value.size.width,
                height: controller.value.size.height,
                child: VideoPlayer(controller),
              ),
            ),
          if (_isLoading)
            const IgnorePointer(
              child: ColoredBox(
                color: AppColors.smokyBlack,
                child: Center(child: CircularProgressIndicator(color: Colors.white)),
              ),
            )
          else if (_isPlaying)
            GestureDetector(
              key: const Key('cover-video-preview-pause'),
              behavior: HitTestBehavior.opaque,
              onTap: _pause,
            )
          else
            GestureDetector(
              key: const Key('cover-video-preview-play'),
              behavior: HitTestBehavior.opaque,
              onTap: _failed ? null : _play,
              child: ColoredBox(
                color: AppColors.smokyBlack,
                child: Center(
                  // styles.playIconContainer: 50 disc, white 90%, "▶" 20.
                  child: Container(
                    width: 50,
                    height: 50,
                    decoration: const BoxDecoration(
                      color: AppColors.whiteTransparent90,
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: const Padding(
                      padding: EdgeInsets.only(left: 3),
                      child: Text('▶', style: TextStyle(fontSize: 20, color: Colors.black)),
                    ),
                  ),
                ),
              ),
            ),
        ],
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Container(
        key: const Key('cover-video-preview'),
        width: double.infinity,
        height: widget.height,
        color: Colors.black,
        child: content,
      ),
    );
  }
}
