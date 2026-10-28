import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';
import '../course_styles.dart';
import '../../data/video_watch_progress.dart';
import 'video_fallback_card.dart';
import 'video_interjection_dialog.dart';
import 'video_player_widget.dart';

/// Port of ally-mobile (React Native)'s `VideoItemPlayer` — native playback
/// + watch tracking for `s3` sources via [VideoPlayerWidget], an
/// open-externally-and-mark-watched fallback for youtube/vimeo/loom via
/// [VideoFallbackCard]. Mirrors ally-web's `VideoItemPlayer`.
class VideoItemPlayer extends ConsumerStatefulWidget {
  const VideoItemPlayer({
    super.key,
    required this.payload,
    required this.itemId,
    required this.alreadyCompleted,
    required this.onCompleted,
  });

  final StartItemPayload payload;
  final String itemId;
  final bool alreadyCompleted;
  final void Function(TrackItemCompletionResult result) onCompleted;

  @override
  ConsumerState<VideoItemPlayer> createState() => _VideoItemPlayerState();
}

class _VideoItemPlayerState extends ConsumerState<VideoItemPlayer> {
  final _videoPlayerKey = GlobalKey<VideoPlayerWidgetState>();
  late final VideoWatchProgressTracker _tracker;
  late final List<VideoInterjection> _interjections;
  final Set<String> _answeredInterjectionIds = {};
  VideoInterjection? _activeInterjection;
  double _lastCheckedTime = 0;
  bool _completed = false;

  @override
  void initState() {
    super.initState();
    _completed = widget.alreadyCompleted;
    // Sorted once per payload so crossing-detection can assume ascending
    // order, same as the RN screen's own `useMemo`.
    _interjections = [...(widget.payload.interjections ?? [])]
      ..sort((a, b) => a.timestampSeconds.compareTo(b.timestampSeconds));
    // Seed already-answered interjections from a previous session so a
    // returning learner doesn't get re-triggered on a seek past them.
    for (final i in _interjections) {
      if (i.answeredPassed != null) _answeredInterjectionIds.add(i.id);
    }
    _tracker = VideoWatchProgressTracker(
      durationSeconds: widget.payload.durationSeconds ?? 0,
      // `maxWatchedPct` is already 0-100, same scale ally-be returns and
      // the RN hook's `initialMaxWatchedPct` expects — not a 0-1 fraction.
      initialMaxWatchedPct: (widget.payload.maxWatchedPct ?? 0).round(),
      onReport: _reportProgress,
    )..disabled = _completed;
  }

  Future<void> _reportProgress(int watchedPct) async {
    try {
      final result = await ref
          .read(coursesRepositoryProvider)
          .reportVideoProgress(
            itemId: widget.itemId,
            watchedPct: watchedPct.toDouble(),
          );
      if (result.completed && mounted) {
        setState(() {
          _completed = true;
          _tracker.disabled = true;
        });
        widget.onCompleted(
          TrackItemCompletionResult(
            completed: true,
            sectionCompleted: result.sectionCompleted,
            trackCompleted: result.trackCompleted,
          ),
        );
      }
    } catch (_) {
      // Server-side monotonic max — a dropped report is recovered by the
      // next one, same as the RN hook's own comment.
    }
  }

  Future<void> _markWatchedExternally() async {
    try {
      final result = await ref
          .read(coursesRepositoryProvider)
          .reportVideoProgress(itemId: widget.itemId, watchedPct: 100);
      if (mounted) {
        setState(() => _completed = _completed || result.completed);
        if (result.completed) {
          widget.onCompleted(
            TrackItemCompletionResult(
              completed: true,
              sectionCompleted: result.sectionCompleted,
              trackCompleted: result.trackCompleted,
            ),
          );
        }
      }
    } catch (_) {
      // Button stays available so the learner can retry, same as the RN
      // screen's handleMarkWatched.
    }
  }

  /// Feeds the watch-progress tracker, and additionally checks for a
  /// forward crossing of the next unanswered interjection. While the
  /// dialog is up the video is already paused, so no further crossing is
  /// checked until it is dismissed. On a crossing, `_lastCheckedTime` is
  /// rewound to that interjection's own timestamp (not the raw playhead)
  /// so any further interjections between it and the current position are
  /// still caught once the learner resumes.
  void _handleProgressTime(double timeSeconds) {
    final shownPct = _tracker.watchedPct;
    _tracker.recordTime(timeSeconds);
    // Rebuild only when the progress bar would change, not on every sample.
    if (mounted && _tracker.watchedPct != shownPct) setState(() {});

    if (_activeInterjection != null) return;

    final crossed = _interjections
        .where(
          (i) =>
              !_answeredInterjectionIds.contains(i.id) &&
              i.timestampSeconds > _lastCheckedTime &&
              i.timestampSeconds <= timeSeconds,
        )
        .firstOrNull;

    if (crossed != null) {
      _lastCheckedTime = crossed.timestampSeconds;
      _videoPlayerKey.currentState?.pause();
      setState(() => _activeInterjection = crossed);
      _showInterjection(crossed);
    } else {
      _lastCheckedTime = timeSeconds;
    }
  }

  Future<void> _showInterjection(VideoInterjection interjection) async {
    // RN `Modal transparent animationType="fade"` over a 50% black overlay.
    await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      barrierColor: AppColors.blackTransparent50,
      useSafeArea: false,
      builder: (_) => VideoInterjectionDialog(
        itemId: widget.itemId,
        interjection: interjection,
      ),
    );
    _answeredInterjectionIds.add(interjection.id);
    if (mounted) setState(() => _activeInterjection = null);
    _videoPlayerKey.currentState?.resume();
  }

  @override
  void dispose() {
    _tracker.flush();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final payload = widget.payload;
    final isS3 =
        payload.videoSource == 's3' && (payload.videoUrl ?? '').isNotEmpty;

    return Column(
      children: [
        if (isS3)
          VideoPlayerWidget(
            key: _videoPlayerKey,
            url: payload.videoUrl!,
            onProgressTime: _handleProgressTime,
            onPauseOrEnd: _tracker.flush,
          )
        else
          Expanded(
            child: VideoFallbackCard(
              url: payload.videoUrl ?? '',
              onMarkWatched: _markWatchedExternally,
            ),
          ),
        // styles.footer: borderTop 0.5, padding 16, centred.
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
          ),
          child: _completed
              ? Row(
                  key: const Key('video-watched-chip'),
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SvgPicture.asset('assets/icons/tickRound.svg', width: 16, height: 16),
                    const SizedBox(width: 6),
                    Text(
                      ref.t('courses.video.watched'),
                      style: const TextStyle(fontFamily: courseSystemFont, fontSize: 14, color: AppColors.green700),
                    ),
                  ],
                )
              // styles.progressTrack: 128 x 6, radius 3, grey[200]; fill primary.
              : Container(
                  key: const Key('video-progress-track'),
                  width: 128,
                  height: 6,
                  clipBehavior: Clip.antiAlias,
                  alignment: Alignment.centerLeft,
                  decoration: BoxDecoration(color: AppColors.grey200, borderRadius: BorderRadius.circular(3)),
                  child: FractionallySizedBox(
                    widthFactor: (_tracker.watchedPct / 100).clamp(0.0, 1.0),
                    heightFactor: 1,
                    child: const ColoredBox(color: AppColors.primary),
                  ),
                ),
        ),
      ],
    );
  }
}
