import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../data/review_api.dart';
import '../data/review_models.dart';
import 'review_formatting.dart';
import 'review_styles.dart';
import 'review_widgets.dart';
import 'simulation_audio_player.dart';
import 'simulation_audio_player_controller.dart';
import 'simulation_details_card.dart';

/// Port of ally-mobile (React Native)'s `ReviewScreen/components/
/// ReviewCard.tsx` — a bordered card per review (padding/gap 16@s):
///
/// - author avatar + name + relative time, then a hairline;
/// - the full note;
/// - simulation: the Date & time / Duration rows, then the scenario's
///   [SimulationDetailsCard]; scribe: one [SimulationDetailsCard] with the
///   call's `summaryName` as title and those rows as its description;
/// - the [SimulationAudioPlayer] (simulation reviews with an `audioUrl`);
/// - "Review Conversation" — only when the user may open the review
///   ([onOpenReview] non-null), RN's `onReviewPress` gate;
/// - a hairline, then [ReactionsCount] and the "N Comments" toggle, which
///   expands the latest two comments inline ([ExpandedComments]).
class ReviewCard extends ConsumerStatefulWidget {
  const ReviewCard({
    super.key,
    required this.review,
    required this.reviewType,
    required this.onOpenReview,
    this.audioPlayerController,
  });

  final ReviewItem review;
  final ReviewType reviewType;

  /// Null when the user lacks the view-review permission.
  final VoidCallback? onOpenReview;

  /// Overridable for tests — forwarded to [SimulationAudioPlayer].
  final SimulationAudioPlaybackController? audioPlayerController;

  @override
  ConsumerState<ReviewCard> createState() => _ReviewCardState();
}

class _ReviewCardState extends ConsumerState<ReviewCard> {
  bool _isExpanded = false;
  bool _isLoadingComments = false;
  CommentPage? _comments;

  bool get _isScribe => widget.reviewType == ReviewType.scribe;

  static final _nameStyle = ReviewText.style(
    RnType.bodyMedium,
    AppFonts.ibmPlexSerifMedium,
    AppColors.highEmphasis,
    weight: FontWeight.w500,
  );
  static final _timeStyle = ReviewText.serif(RnType.bodySmall, AppColors.mediumEmphasis);
  static final _noteStyle = ReviewText.serif(RnType.bodyMedium, AppColors.highEmphasis);
  static final _reviewTranscriptStyle = ReviewText.style(
    RnType.bodyMedium,
    AppFonts.robotoRegular,
    AppColors.primary,
    weight: FontWeight.w500,
  );
  static final _commentCountStyle = ReviewText.style(
    RnType.bodySmall,
    AppFonts.ibmPlexSerifMedium,
    AppColors.mediumEmphasis,
    weight: FontWeight.w500,
  );

  /// RN's `handleCommentPress`: collapse if open; otherwise fetch the
  /// overview once (offset 0, limit 2) and expand. A review with no
  /// comments does nothing.
  Future<void> _toggleComments() async {
    if (_isExpanded) {
      setState(() => _isExpanded = false);
      return;
    }
    if (widget.review.commentsCount == 0) return;
    if (_comments != null) {
      setState(() => _isExpanded = true);
      return;
    }
    setState(() => _isLoadingComments = true);
    try {
      final page = await ref.read(reviewApiProvider(widget.reviewType)).getCommentsOverview(widget.review.id);
      if (mounted) setState(() => _comments = page);
    } catch (_) {
      // RN expands anyway; the empty state then shows.
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingComments = false;
          _isExpanded = true;
        });
      }
    }
  }

  List<Widget> _detailRows(String? createdAt, String? duration) => [
    if (createdAt != null && createdAt.isNotEmpty)
      ReviewDetailRow(label: ref.t('review.details.dateAndTime'), value: formatReviewDateTime(createdAt)),
    if (duration != null)
      ReviewDetailRow(label: ref.t('review.feedCard.duration'), value: formatReviewDuration(duration)),
  ];

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final review = widget.review;
    final scenarioSession = review.scenarioSession;
    final scribeSession = review.scribeSession;
    final sessionCreatedAt = scenarioSession?.createdAt ?? scribeSession?.createdAt;
    final sessionDuration = scenarioSession?.duration ?? scribeSession?.duration;
    final audioUrl = _isScribe ? null : scenarioSession?.audioUrl;
    final typeLabel = ref.t('review.feedCard.reviewType', {'reviewType': _isScribe ? 'Scribe' : 'Simulation'});
    final separator = Container(height: rn.vs(0.5), color: AppColors.strokePrimary);
    final gap = SizedBox(height: rn.s(16));

    final children = <Widget>[
      Row(
        children: [
          ReviewUserAvatar(
            name: review.createdBy.name,
            imageUrl: review.createdBy.profileImage,
            size: 36,
            textStyle: RnType.bodyLarge,
          ),
          SizedBox(width: rn.s(8)),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(review.createdBy.name, style: _nameStyle),
                Text(formatReviewRelativeTime(ref, review.createdAt), style: _timeStyle),
              ],
            ),
          ),
        ],
      ),
      separator,
      if (review.note.isNotEmpty)
        Padding(
          padding: EdgeInsets.only(bottom: rn.s(8)),
          child: Text(review.note, style: _noteStyle),
        ),
      if (_isScribe)
        SimulationDetailsCard(
          typeLabel: typeLabel,
          reviewType: widget.reviewType,
          title: scribeSession?.summaryName,
          descriptionWidget: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: _detailRows(sessionCreatedAt, sessionDuration),
          ),
        )
      else ...[
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: _detailRows(sessionCreatedAt, sessionDuration)),
        if (review.scenario != null)
          SimulationDetailsCard(
            typeLabel: typeLabel,
            reviewType: widget.reviewType,
            title: review.scenario!.title,
            coverImageUrl: review.scenario!.coverImageUrl,
            coverVideoUrl: review.scenario!.coverVideoUrl,
            descriptionText: htmlToPlainText(review.scenario!.description),
          ),
      ],
      if (audioUrl != null)
        SimulationAudioPlayer(
          audioUrl: audioUrl,
          controller: widget.audioPlayerController,
          // styles.audioPlayer: marginHorizontal 0, marginBottom 0,
          // paddingVertical 8.
          margin: EdgeInsets.zero,
          verticalPadding: 8,
        ),
      if (widget.onOpenReview != null)
        Center(
          child: GestureDetector(
            key: const Key('review-card-open'),
            behavior: HitTestBehavior.opaque,
            onTap: widget.onOpenReview,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SvgPicture.asset('assets/icons/chatAddOn.svg', width: rn.raw(16), height: rn.raw(16)),
                SizedBox(width: rn.s(8)),
                Text(ref.t('review.feedCard.reviewTranscript'), style: _reviewTranscriptStyle),
              ],
            ),
          ),
        ),
      separator,
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: ReactionsCount(reviewId: review.id, reactions: review.reactions, reviewType: widget.reviewType),
          ),
          SizedBox(width: rn.s(16)),
          GestureDetector(
            key: const Key('review-card-comments'),
            behavior: HitTestBehavior.opaque,
            onTap: _toggleComments,
            child: Text(
              pluralize(review.commentsCount, ref.t('review.details.commentLabel')),
              style: _commentCountStyle,
            ),
          ),
        ],
      ),
      if (_isExpanded)
        ExpandedComments(
          isLoading: _isLoadingComments,
          page: _comments,
          onCollapsePress: _toggleComments,
          onCommentPress: widget.onOpenReview,
        ),
    ];

    return Container(
      padding: EdgeInsets.all(rn.s(16)),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        borderRadius: BorderRadius.circular(rn.raw(16)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (i, child) in children.indexed) ...[if (i > 0) gap, child],
        ],
      ),
    );
  }
}

/// Port of RN's `ReviewScreen/components/ExpandedComments.tsx`: the latest
/// couple of comments (no reply / add-reaction buttons; tapping one opens
/// the review), "No comments yet" when there are none, "Show more" when
/// there are more than two, and a "Collapse" link.
class ExpandedComments extends ConsumerWidget {
  const ExpandedComments({
    super.key,
    required this.isLoading,
    required this.page,
    required this.onCollapsePress,
    this.onCommentPress,
  });

  final bool isLoading;
  final CommentPage? page;
  final VoidCallback onCollapsePress;
  final VoidCallback? onCommentPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final comments = page?.comments ?? const <ThreadComment>[];
    final hasComments = comments.isNotEmpty;
    final gap = SizedBox(height: rn.s(8));

    final children = <Widget>[
      Padding(
        padding: EdgeInsets.symmetric(vertical: rn.s(8)),
        child: Container(height: rn.vs(0.5), color: AppColors.strokePrimary),
      ),
      if (isLoading)
        Padding(
          padding: EdgeInsets.symmetric(vertical: rn.s(16)),
          child: const Center(child: CircularProgressIndicator(color: AppColors.primary)),
        )
      else ...[
        for (final comment in comments)
          Padding(
            padding: EdgeInsets.symmetric(vertical: rn.s(4)),
            child: ReviewCommentTile(
              comment: comment,
              showReplyButton: false,
              showAddReactionButton: false,
              onCommentPress: onCommentPress,
            ),
          ),
        if (!hasComments)
          Padding(
            padding: EdgeInsets.symmetric(vertical: rn.s(16)),
            child: Text(
              ref.t('review.details.noCommentsYet'),
              textAlign: TextAlign.center,
              style: ReviewText.serif(RnType.bodySmall, AppColors.mediumEmphasis),
            ),
          ),
      ],
      if (hasComments && (page?.count ?? 0) > 2 && onCommentPress != null)
        Align(
          alignment: Alignment.centerLeft,
          child: GestureDetector(
            key: const Key('expanded-comments-show-more'),
            behavior: HitTestBehavior.opaque,
            onTap: onCommentPress,
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: rn.s(4)),
              child: Text(
                ref.t('review.feedCard.showMore'),
                style: ReviewText.style(
                  RnType.bodySmall,
                  AppFonts.ibmPlexSerifMedium,
                  AppColors.primary,
                  weight: FontWeight.w500,
                ),
              ),
            ),
          ),
        ),
      GestureDetector(
        key: const Key('expanded-comments-collapse'),
        behavior: HitTestBehavior.opaque,
        onTap: onCollapsePress,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Padding(
              padding: EdgeInsets.only(right: rn.s(4)),
              child: Text(
                ref.t('calls.uploadProgress.collapse'),
                style: ReviewText.style(
                  RnType.bodyMedium,
                  AppFonts.ibmPlexSerifMedium,
                  AppColors.mediumEmphasis,
                  weight: FontWeight.w500,
                ),
              ),
            ),
            SizedBox(width: rn.s(8)),
            Transform.rotate(
              angle: math.pi,
              child: SvgPicture.asset(
                'assets/icons/chevronDown.svg',
                width: rn.raw(16),
                height: rn.raw(16),
                colorFilter: const ColorFilter.mode(AppColors.iconDefault, BlendMode.srcIn),
              ),
            ),
          ],
        ),
      ),
    ];

    return Column(
      key: const Key('expanded-comments'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, child) in children.indexed) ...[if (i > 0) gap, child],
      ],
    );
  }
}
