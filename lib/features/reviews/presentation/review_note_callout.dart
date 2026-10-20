import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `src/screens/
/// ReviewDetailsScreen/components/ReviewNote.tsx` — an orange-tinted,
/// left-bordered callout distinguishing the reviewer's free-text note from
/// the rest of the screen. Scoped to the note display only: RN's edit
/// affordance (a pencil icon when a note exists, a "+" button to add one
/// when it doesn't) opens the create-review screen in an edit mode gated on
/// a time window + review ownership + hidden-status check
/// (`!isMinutesPassed(reviewData.createdAt) && userData?.id ===
/// reviewData.createdBy?.id && reviewData.reviewStatus !== HIDDEN`) that
/// navigates into `ShareForReviewScreen`'s own edit-note mode — neither
/// exists in this app yet, so there's nothing to wire the button to. Only
/// rendered when there's a note to show, rather than an empty callout with
/// no working action.
class ReviewNoteCallout extends ConsumerWidget {
  const ReviewNoteCallout({super.key, required this.note});

  final String note;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: AppColors.orange50,
        border: Border(left: BorderSide(color: AppColors.orange400)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            ref.t('review.details.noteLabel'),
            style: const TextStyle(
              fontFamily: AppFonts.robotoRegular,
              fontSize: 14,
              height: 22 / 14,
              letterSpacing: 0.2,
              color: AppColors.orange900,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            note,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 14,
              height: 22 / 14,
              letterSpacing: 0.2,
              color: AppColors.highEmphasis,
            ),
          ),
        ],
      ),
    );
  }
}
