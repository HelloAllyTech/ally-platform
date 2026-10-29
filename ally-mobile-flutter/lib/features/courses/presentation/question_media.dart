import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:video_player/video_player.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../data/quiz_models.dart';
import 'course_styles.dart';

/// Embeddable player URL for a third-party clip. Mirrors RN `embedUrlFor`.
String? questionMediaEmbedUrl(QuestionMedia media) {
  final url = media.url.trim();
  final youtube = RegExp(r'(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/)|youtu\.be/)([\w-]{6,})').firstMatch(url);
  if (youtube != null) return 'https://www.youtube.com/embed/${youtube.group(1)}';
  final vimeo = RegExp(r'(?:player\.)?vimeo\.com/(?:video/)?(\d+)').firstMatch(url);
  if (vimeo != null) return 'https://player.vimeo.com/video/${vimeo.group(1)}';
  final loom = RegExp(r'loom\.com/(?:share|embed)/([a-zA-Z0-9]+)').firstMatch(url);
  if (loom != null) return 'https://www.loom.com/embed/${loom.group(1)}';
  return null;
}

/// Port of RN `components/players/QuestionMedia.tsx` — the picture or clip a
/// question is asking about, between the prompt and the answer controls.
/// Shared by the quiz player, quiz results, video interjections and inline
/// article questions. Nothing autoplays; tapping an image opens it full
/// screen; a failed image says so in words.
class QuestionMediaView extends ConsumerStatefulWidget {
  const QuestionMediaView({super.key, required this.media});

  final QuestionMedia? media;

  @override
  ConsumerState<QuestionMediaView> createState() => _QuestionMediaViewState();
}

class _QuestionMediaViewState extends ConsumerState<QuestionMediaView> {
  bool _failed = false;

  @override
  void didUpdateWidget(QuestionMediaView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.media?.url != widget.media?.url) _failed = false;
  }

  void _openLightbox(QuestionMedia media) {
    showGeneralDialog<void>(
      context: context,
      barrierColor: Colors.transparent,
      barrierDismissible: false,
      transitionDuration: const Duration(milliseconds: 200),
      transitionBuilder: (context, animation, _, child) => FadeTransition(opacity: animation, child: child),
      pageBuilder: (dialogContext, _, _) => Semantics(
        button: true,
        label: ref.t('courses.question.media.close'),
        child: GestureDetector(
          key: const Key('question-media-lightbox'),
          onTap: () => Navigator.of(dialogContext).pop(),
          child: Container(
            color: AppColors.lightboxScrim,
            padding: const EdgeInsets.all(16),
            alignment: Alignment.center,
            child: Image.network(media.url, fit: BoxFit.contain, width: double.infinity, height: double.infinity),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final media = widget.media;
    if (media == null || media.url.isEmpty) return const SizedBox.shrink();

    if (media.kind == 'image') {
      if (_failed) {
        // styles.failed: marginBottom 16, padding 12, radius 12, gap 4.
        return Container(
          key: const Key('question-media-failed'),
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 16),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(12)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                ref.t('courses.question.media.imageFailed'),
                style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
              ),
              if ((media.alt ?? '').isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  media.alt!,
                  style: CourseText.serif(
                    CourseType.bodySmall,
                    AppColors.mediumEmphasis,
                  ).copyWith(fontStyle: FontStyle.italic),
                ),
              ],
            ],
          ),
        );
      }
      return Semantics(
        button: true,
        image: true,
        label: (media.alt ?? '').isNotEmpty ? media.alt : ref.t('courses.question.media.viewLarger'),
        child: GestureDetector(
          key: const Key('question-media-image'),
          onTap: () => _openLightbox(media),
          child: Container(
            width: double.infinity,
            height: 180,
            margin: const EdgeInsets.only(bottom: 16),
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(12)),
            child: Image.network(
              media.url,
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted && !_failed) setState(() => _failed = true);
                });
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );
    }

    final Widget player;
    if (media.source == 's3') {
      player = _QuestionVideo(key: ValueKey(media.url), media: media);
    } else {
      final embedUrl = questionMediaEmbedUrl(media);
      if (embedUrl == null) return const SizedBox.shrink();
      player = _QuestionEmbed(key: ValueKey(embedUrl), url: embedUrl);
    }
    // styles.videoFrame: 16:9, marginBottom 16, radius 12, black.
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: AppColors.black, borderRadius: BorderRadius.circular(12)),
      child: AspectRatio(aspectRatio: 16 / 9, child: player),
    );
  }
}

/// RN `<Video controls paused poster>` for an uploaded clip.
class _QuestionVideo extends StatefulWidget {
  const _QuestionVideo({super.key, required this.media});

  final QuestionMedia media;

  @override
  State<_QuestionVideo> createState() => _QuestionVideoState();
}

class _QuestionVideoState extends State<_QuestionVideo> {
  late final VideoPlayerController _controller;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.media.url))
      ..initialize().then((_) {
        if (mounted) setState(() {});
      }).catchError((_) {});
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final poster = widget.media.posterUrl;
    return ValueListenableBuilder<VideoPlayerValue>(
      key: const Key('question-media-video'),
      valueListenable: _controller,
      builder: (context, value, _) => GestureDetector(
        onTap: () {
          if (!value.isInitialized) return;
          if (value.isPlaying) {
            _controller.pause();
          } else {
            _started = true;
            _controller.play();
          }
        },
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (value.isInitialized)
              Center(
                child: AspectRatio(aspectRatio: value.aspectRatio, child: VideoPlayer(_controller)),
              ),
            if (!_started && poster != null && poster.isNotEmpty)
              Image.network(poster, fit: BoxFit.contain, errorBuilder: (_, _, _) => const SizedBox.shrink()),
            if (!value.isPlaying)
              Center(child: SizedBox(
                width: 48,
                height: 48,
                child: SvgPicture.asset('assets/icons/playWhite.svg'),
              )),
            if (value.isInitialized)
              Align(
                alignment: Alignment.bottomCenter,
                child: VideoProgressIndicator(_controller, allowScrubbing: true, padding: const EdgeInsets.all(8)),
              ),
          ],
        ),
      ),
    );
  }
}

/// RN `<WebView source={{uri: embedUrl}} mediaPlaybackRequiresUserAction>`.
class _QuestionEmbed extends StatefulWidget {
  const _QuestionEmbed({super.key, required this.url});

  final String url;

  @override
  State<_QuestionEmbed> createState() => _QuestionEmbedState();
}

class _QuestionEmbedState extends State<_QuestionEmbed> {
  WebViewController? _controller;

  @override
  void initState() {
    super.initState();
    try {
      _controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..loadRequest(Uri.parse(widget.url));
    } catch (_) {
      // No WebView platform (widget tests): the black frame stays empty.
      _controller = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return KeyedSubtree(
      key: const Key('question-media-embed'),
      child: controller == null ? const SizedBox.expand() : WebViewWidget(controller: controller),
    );
  }
}
