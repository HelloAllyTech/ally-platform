import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `src/screens/
/// ReviewDetailsScreen/components/ReviewNote.tsx` — an orange-tinted,
/// left-bordered callout distinguishing the reviewer's free-text note from
/// the rest of the screen, with a pencil edit affordance shown only when
/// [onEditNote] is supplied (the caller is responsible for RN's own gating:
/// `!isMinutesPassed(reviewData.createdAt) && userData?.id ===
/// reviewData.createdBy?.id && reviewData.reviewStatus !== HIDDEN`). RN also
/// shows a "+" button to add a note when none exists yet — not ported, since
/// this widget (matching its call site) only renders when there's already a
/// note to show.
class ReviewNoteCallout extends ConsumerWidget {
  const ReviewNoteCallout({super.key, required this.note, this.onEditNote});

  final String note;
  final VoidCallback? onEditNote;

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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
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
              if (onEditNote != null)
                IconButton(
                  icon: const Icon(Icons.edit, size: 16),
                  tooltip: ref.t('review.details.editNote'),
                  visualDensity: VisualDensity.compact,
                  onPressed: onEditNote,
                ),
            ],
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
