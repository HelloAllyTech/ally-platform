import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../data/review_models.dart';
import 'review_formatting.dart';
import 'simulation_audio_player.dart';
import 'simulation_audio_player_controller.dart';
import 'simulation_details_card.dart';

/// Port of ally-mobile (React Native)'s `ReviewScreen/components/
/// ReviewCard.tsx` — a bordered card per review, confirmed from source to
/// be structured very differently from a plain list tile:
///
/// - User avatar + name + relative time ("4 months"), not an absolute date.
/// - The full note text (RN never truncates it here).
/// - For a simulation review: plain (un-boxed) Date&time/Duration rows,
///   then a separate bordered [_SimulationDetailsCard] with the scenario's
///   cover image, the [ReviewTypeChip], its title, and a "View more"/"View
///   less"-expandable description.
/// - For a scribe review: just the one bordered [_SimulationDetailsCard],
///   with the scribe illustration instead of a cover photo, the call's
///   `summaryName` as its title, and — confirmed from source this is a
///   deliberate reuse, not a bug — the Date&time/Duration rows rendered
///   INSIDE the card where a text description would otherwise go (scribe
///   sessions have no separate description field to show there).
/// - [SimulationAudioPlayer], simulation reviews only, when `audioUrl` is
///   present — confirmed RN embeds the same player here, not just on
///   `ReviewDetailsScreen`.
/// - A single "Review Conversation" link — confirmed this is the ONLY tap
///   target that opens the detail screen; the rest of the card has no
///   whole-card press handler in the real component.
/// - A reactions + comment-count row at the bottom.
///
/// Not ported: inline-expandable general comments (RN's `ExpandedComments`
/// shows the first couple of comments right in the card on tap) — the
/// comment count here instead opens the detail screen's Discussion tab,
/// same destination, one tap further. Also not ported: a scenario's cover
/// *video* (`coverVideoUrl`) — the still cover image only.
class ReviewCard extends ConsumerWidget {
  const ReviewCard({
    super.key,
    required this.review,
    required this.reviewType,
    required this.canViewDetails,
    required this.onOpenReview,
    this.audioPlayerController,
  });

  final ReviewItem review;
  final ReviewType reviewType;
  final bool canViewDetails;
  final VoidCallback onOpenReview;

  /// Overridable for tests — forwarded to [SimulationAudioPlayer]. See that
  /// widget's own doc comment for why this seam exists.
  final SimulationAudioPlaybackController? audioPlayerController;

  bool get _isScribe => reviewType == ReviewType.scribe;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = _isScribe ? null : review.scenarioSession;
    final showAudioPlayer = !_isScribe && session?.audioUrl != null;
    final totalReactions = review.reactions.values.fold(0, (sum, count) => sum + count);
    final typeLabel = ref.t('review.feedCard.reviewType', {
      'reviewType': _isScribe ? 'Scribe' : 'Simulation',
    });

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundImage: review.createdBy.profileImage.isNotEmpty
                    ? NetworkImage(review.createdBy.profileImage)
                    : null,
                child: review.createdBy.profileImage.isEmpty
                    ? Text(
                        review.createdBy.name.isNotEmpty
                            ? review.createdBy.name[0].toUpperCase()
                            : '?',
                      )
                    : null,
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    review.createdBy.name,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      color: AppColors.highEmphasis,
                    ),
                  ),
                  Text(
                    formatReviewRelativeTime(ref, review.createdAt),
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 12,
                      color: AppColors.mediumEmphasis,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const Divider(height: 24),
          if (review.note.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                review.note,
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  color: AppColors.highEmphasis,
                ),
              ),
            ),
          if (!_isScribe) ...[
            if (session?.createdAt != null)
              ReviewDetailRow(
                label: ref.t('review.details.dateAndTime'),
                value: formatReviewDateTime(session!.createdAt!),
              ),
            if (session?.duration != null)
              ReviewDetailRow(
                label: ref.t('review.feedCard.duration'),
                value: formatReviewDuration(session!.duration),
              ),
            const SizedBox(height: 8),
          ],
          SimulationDetailsCard(
            typeLabel: typeLabel,
            reviewType: reviewType,
            title: _isScribe ? review.scribeSession?.summaryName : review.scenario?.title,
            coverImageUrl: _isScribe ? null : review.scenario?.coverImageUrl,
            illustrationAsset: _isScribe ? 'assets/icons/scribeReview.svg' : null,
            descriptionText: _isScribe ? null : htmlToPlainText(review.scenario?.description),
            descriptionWidget: !_isScribe
                ? null
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (review.scribeSession?.createdAt != null)
                        ReviewDetailRow(
                          label: ref.t('review.details.dateAndTime'),
                          value: formatReviewDateTime(review.scribeSession!.createdAt!),
                        ),
                      if (review.scribeSession?.duration != null)
                        ReviewDetailRow(
                          label: ref.t('review.feedCard.duration'),
                          value: formatReviewDuration(review.scribeSession!.duration),
                        ),
                    ],
                  ),
          ),
          if (showAudioPlayer)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: SimulationAudioPlayer(
                audioUrl: session!.audioUrl!,
                controller: audioPlayerController,
              ),
            ),
          const SizedBox(height: 8),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Center(
            child: TextButton.icon(
              onPressed: canViewDetails ? onOpenReview : null,
              icon: SvgPicture.asset('assets/icons/chatAddOn.svg', width: 16, height: 16),
              label: Text(ref.t('review.feedCard.reviewTranscript')),
            ),
          ),
          const SizedBox(height: 4),
          const Divider(height: 1),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: InkWell(
                  onTap: () => context.push('/reactions/${review.id}', extra: reviewType),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (totalReactions > 0) ...[
                        SvgPicture.asset('assets/icons/smile.svg', width: 20, height: 20),
                        const SizedBox(width: 8),
                      ],
                      Flexible(
                        child: Text(
                          totalReactions == 1
                              ? '$totalReactions ${ref.t('review.feedCard.reactions')}'
                              : '$totalReactions ${ref.t('review.feedCard.reactions_plural')}',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Flexible(
                child: InkWell(
                  onTap: canViewDetails ? onOpenReview : null,
                  child: Text(
                    review.commentsCount == 1
                        ? '${review.commentsCount} ${ref.t('review.feedCard.comments')}'
                        : '${review.commentsCount} ${ref.t('review.feedCard.comments_plural')}',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 12,
                      color: AppColors.mediumEmphasis,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

