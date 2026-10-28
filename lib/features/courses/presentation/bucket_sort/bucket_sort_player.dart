import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../course_button.dart';
import '../course_styles.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';

/// The bucket-sort subset of a [StartItemPayload], replaced wholesale on
/// "Sort again" — mirrors ally-mobile (React Native)'s own local `data`
/// state in `BucketSortPlayer.tsx`.
class _BucketSortData {
  _BucketSortData({
    required this.intro,
    required this.buckets,
    required this.items,
    required this.bestFirstTryPct,
  });

  factory _BucketSortData.fromPayload(StartItemPayload p) => _BucketSortData(
    intro: p.bucketSortIntro,
    buckets: p.bucketSortBuckets!,
    items: p.bucketSortItems!,
    bestFirstTryPct: p.bucketSortBestFirstTryPct,
  );

  final String? intro;
  final List<BucketSortBucket> buckets;
  final List<BucketSortItem> items;
  final int? bestFirstTryPct;
}

/// Bucket sort: one item at a time, placed by tapping the bucket it belongs
/// in. The server owns the answer key, so every placement is a round trip,
/// and what comes back — verdict, the right bucket, the author's
/// explanation — is shown before the next item appears. A wrong guess is
/// deliberately final: the first placement is what the course learns from,
/// and after the feedback the item sits in its correct bucket.
///
/// The completion the last placement earns is held until the learner has
/// read the feedback and tapped "See results". The server has already
/// recorded it; reporting it opens the course-complete celebration, which
/// would otherwise cover the final item's feedback and the results.
///
/// Direct port of ally-mobile (React Native)'s `BucketSortPlayer.tsx`.
class BucketSortPlayer extends ConsumerStatefulWidget {
  const BucketSortPlayer({
    super.key,
    required this.payload,
    required this.itemId,
    required this.onCompleted,
    required this.onRequestNext,
  });

  final StartItemPayload payload;
  final String itemId;
  final void Function(TrackItemCompletionResult result) onCompleted;
  final VoidCallback onRequestNext;

  @override
  ConsumerState<BucketSortPlayer> createState() => _BucketSortPlayerState();
}

class _BucketSortPlayerState extends ConsumerState<BucketSortPlayer> {
  late _BucketSortData _data = _BucketSortData.fromPayload(widget.payload);
  late Map<String, BucketSortFeedback> _answered = {
    ...widget.payload.bucketSortAnswered ?? const {},
  };
  String? _reviewingId;
  bool _failed = false;
  bool _isPlacing = false;
  bool _isRestarting = false;
  TrackItemCompletionResult? _pendingCompletion;

  List<BucketSortBucket> get _buckets => _data.buckets;
  List<BucketSortItem> get _items => _data.items;
  Map<String, String> get _bucketName => {for (final b in _buckets) b.id: b.label};
  int get _placedCount => _answered.length;

  BucketSortItem? get _reviewing {
    final id = _reviewingId;
    if (id == null) return null;
    for (final i in _items) {
      if (i.id == id) return i;
    }
    return null;
  }

  BucketSortFeedback? get _feedback => _reviewingId != null ? _answered[_reviewingId] : null;

  BucketSortItem? get _current {
    final reviewing = _reviewing;
    if (reviewing != null) return reviewing;
    for (final i in _items) {
      if (!_answered.containsKey(i.id)) return i;
    }
    return null;
  }

  bool get _finished => _placedCount == _items.length && _reviewing == null;
  bool get _canPlace => _current != null && _reviewing == null && !_isPlacing;

  Future<void> _place(String sortItemId, String bucketId) async {
    if (_isPlacing || _reviewingId != null) return;
    setState(() {
      _failed = false;
      _isPlacing = true;
    });
    try {
      final result = await ref
          .read(coursesRepositoryProvider)
          .placeBucketSortItem(itemId: widget.itemId, sortItemId: sortItemId, bucketId: bucketId);
      if (!mounted) return;
      setState(() {
        _answered = {
          ..._answered,
          sortItemId: BucketSortFeedback(
            correct: result.correct,
            placedBucketId: result.placedBucketId,
            correctBucketId: result.correctBucketId,
            explanation: result.explanation,
          ),
        };
        _reviewingId = sortItemId;
      });
      if (result.completion != null) _pendingCompletion = result.completion;
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _isPlacing = false);
    }
  }

  void _handleNext() {
    setState(() => _reviewingId = null);
    final pending = _pendingCompletion;
    if (pending != null) {
      _pendingCompletion = null;
      widget.onCompleted(pending);
    }
  }

  Future<void> _handleRestart() async {
    setState(() {
      _failed = false;
      _isRestarting = true;
    });
    try {
      await ref.read(coursesRepositoryProvider).restartBucketSort(widget.itemId);
      final fresh = await ref.read(coursesRepositoryProvider).startTrackItem(widget.itemId);
      if (!mounted) return;
      if (fresh.type != 'BUCKET_SORT') return;
      setState(() {
        _data = _BucketSortData.fromPayload(fresh);
        _answered = {...fresh.bucketSortAnswered ?? const {}};
        _reviewingId = null;
      });
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _isRestarting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = _current;
    final reviewing = _reviewing;
    final feedback = _feedback;
    final finished = _finished;
    final firstTryPct = (_answered.values.where((a) => a.correct).length /
            (_items.isEmpty ? 1 : _items.length) *
            100)
        .round();
    final missed = _items.where((i) => _answered[i.id] != null && !_answered[i.id]!.correct).toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_data.intro != null) ...[
          Text(_data.intro!, style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis)),
          const SizedBox(height: 12),
        ],
        if (!finished && current != null) ...[
          Text(
            ref.t('courses.bucketSort.progress', {'placed': _placedCount, 'total': _items.length}),
            key: const Key('bucket-sort-progress'),
            style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
          ),
          const SizedBox(height: 4),
          Text(
            ref.t('courses.bucketSort.whereDoesItGo'),
            style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis, weight: FontWeight.w500),
          ),
          const SizedBox(height: 8),
          Container(
            key: const Key('bucket-sort-item'),
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.primary, width: 2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              current.text,
              style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
            ),
          ),
          if (reviewing == null) ...[
            const SizedBox(height: 8),
            Text(
              ref.t('courses.bucketSort.tapHint'),
              style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
            ),
          ],
          const SizedBox(height: 12),
        ],
        for (final bucket in _buckets) _buildBucket(bucket, current, feedback),
        if (_failed) ...[
          const SizedBox(height: 8),
          // RN `accessibilityRole="alert"`.
          Semantics(
            liveRegion: true,
            child: Text(
              ref.t('courses.bucketSort.placeFailed'),
              textAlign: TextAlign.center,
              style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
            ),
          ),
        ],
        if (reviewing != null && feedback != null) _buildFeedback(feedback),
        if (finished) _buildResults(firstTryPct, missed),
      ],
    );
  }

  Widget _buildBucket(BucketSortBucket bucket, BucketSortItem? current, BucketSortFeedback? feedback) {
    final settled = _items.where(
      (i) => _answered[i.id]?.correctBucketId == bucket.id && i.id != _reviewingId,
    );
    final isTarget = feedback?.correctBucketId == bucket.id;
    final isWrong = feedback != null && !feedback.correct && feedback.placedBucketId == bucket.id;
    final canPlace = _canPlace;
    final onTap = canPlace && current != null ? () => _place(current.id, bucket.id) : null;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      // RN Pressable: role button, `disabled: !canPlace`, and the label
      // `bucketA11y` ("Place "item" in bucket") while an item is up, else
      // the bucket's own label — replacing the card's text for a reader.
      child: Semantics(
        key: Key('bucket-semantics-${bucket.id}'),
        button: true,
        enabled: canPlace,
        label: current != null
            ? ref.t('courses.bucketSort.bucketA11y', {'item': current.text, 'bucket': bucket.label})
            : bucket.label,
        onTap: onTap,
        excludeSemantics: true,
        child: InkWell(
        key: Key('bucket-${bucket.id}'),
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            border: Border.all(
              color: isTarget
                  ? AppColors.onSuccessContainer
                  : isWrong
                  ? AppColors.onErrorContainer
                  : AppColors.strokePrimary,
              width: 1.5,
            ),
            color: isTarget
                ? AppColors.successContainer
                : isWrong
                ? AppColors.errorContainer
                : Colors.white,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                bucket.label,
                style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
              ),
              if (bucket.description != null)
                Text(
                  bucket.description!,
                  style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
                ),
              if (isTarget && current != null) _settledChip(current.text, active: true),
              // The red card is the wrong pick for THIS item, not for the
              // ones already settled in it, so show which item was
              // misplaced.
              if (isWrong && current != null)
                _settledChip(current.text, active: true, misplaced: true),
              for (final item in settled) _settledChip(item.text, active: false),
            ],
          ),
        ),
      ),
      ),
    );
  }

  Widget _settledChip(String text, {required bool active, bool misplaced = false}) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Container(
        key: misplaced ? const Key('bucket-sort-misplaced') : null,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: active ? Colors.white : AppColors.grey100,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          text,
          style: CourseText.serif(
            CourseType.bodySmall,
            misplaced ? AppColors.onErrorContainer : AppColors.highEmphasis,
            weight: active ? FontWeight.w500 : FontWeight.w400,
          ).copyWith(
            decoration: misplaced ? TextDecoration.lineThrough : null,
            decorationColor: AppColors.onErrorContainer,
          ),
        ),
      ),
    );
  }

  Widget _buildFeedback(BucketSortFeedback feedback) {
    // RN `accessibilityLiveRegion="polite"`.
    return Semantics(
      liveRegion: true,
      child: _buildFeedbackCard(feedback),
    );
  }

  Widget _buildFeedbackCard(BucketSortFeedback feedback) {
    return Container(
      key: const Key('bucket-sort-feedback'),
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: feedback.correct ? AppColors.successContainer : AppColors.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            feedback.correct ? ref.t('courses.bucketSort.correct') : ref.t('courses.bucketSort.notQuite'),
            style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
          ),
          if (!feedback.correct) ...[
            const SizedBox(height: 6),
            Text(
              '${ref.t('courses.bucketSort.youChose', {'bucket': _bucketName[feedback.placedBucketId]})} '
              '${ref.t('courses.bucketSort.belongsIn', {'bucket': _bucketName[feedback.correctBucketId]})}',
              style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis),
            ),
          ],
          if (feedback.explanation != null) ...[
            const SizedBox(height: 6),
            Text(feedback.explanation!, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
          ],
          const SizedBox(height: 10),
          CourseButton(
            key: const Key('bucket-sort-next'),
            label: _placedCount == _items.length
                ? ref.t('courses.bucketSort.seeResults')
                : ref.t('courses.bucketSort.next'),
            onPressed: _handleNext,
          ),
        ],
      ),
    );
  }

  Widget _buildResults(int firstTryPct, List<BucketSortItem> missed) {
    return Container(
      key: const Key('bucket-sort-results'),
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.strokePrimary, width: 1.5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            ref.t('courses.bucketSort.resultsHeading'),
            style: CourseText.serif(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
          ),
          const SizedBox(height: 10),
          Text(
            ref.t('courses.bucketSort.firstTry', {'pct': firstTryPct}),
            style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis),
          ),
          if (_data.bestFirstTryPct != null)
            Text(
              ref.t('courses.bucketSort.best', {'pct': _data.bestFirstTryPct}),
              style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
            ),
          if (missed.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                ref.t('courses.bucketSort.allRight'),
                style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis),
              ),
            )
          else ...[
            const SizedBox(height: 4),
            Text(
              ref.t('courses.bucketSort.reviewHeading'),
              style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis, weight: FontWeight.w500),
            ),
            for (final item in missed)
              Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.errorContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.text, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
                    Text(
                      ref.t('courses.bucketSort.belongsIn', {
                        'bucket': _bucketName[_answered[item.id]!.correctBucketId],
                      }),
                      style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
                    ),
                    if (_answered[item.id]!.explanation != null)
                      Text(
                        _answered[item.id]!.explanation!,
                        style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
                      ),
                  ],
                ),
              ),
          ],
          const SizedBox(height: 16),
          CourseButton(
            key: const Key('bucket-sort-continue'),
            label: ref.t('courses.bucketSort.continue'),
            onPressed: widget.onRequestNext,
          ),
          const SizedBox(height: 10),
          CourseButton(
            key: const Key('bucket-sort-restart'),
            label: ref.t('courses.bucketSort.practiceAgain'),
            variant: CourseButtonVariant.secondary,
            isLoading: _isRestarting,
            onPressed: _handleRestart,
          ),
        ],
      ),
    );
  }
}
