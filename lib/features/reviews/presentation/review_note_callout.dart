import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import 'review_styles.dart';

/// Direct port of ally-mobile (React Native)'s `ReviewDetailsScreen/
/// components/ReviewNote.tsx`: an orange50 callout with a 1pt orange400
/// left rule, a "NOTE" label (Roboto, orange900) and the note. With
/// [onEditNote] (RN's gate: own review, not hidden, within 10 minutes) it
/// shows a round edit button — or, when there's no note yet, a square "+".
class ReviewNoteCallout extends ConsumerWidget {
  const ReviewNoteCallout({super.key, required this.note, this.onEditNote});

  final String? note;
  final VoidCallback? onEditNote;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasNote = note != null && note!.isNotEmpty;
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
            children: [
              Flexible(
                child: Text(
                  ref.t('review.details.noteLabel'),
                  overflow: TextOverflow.ellipsis,
                  style: ReviewText.style(RnType.bodyMedium, AppFonts.robotoRegular, AppColors.orange900),
                ),
              ),
              if (!hasNote && onEditNote != null) ...[
                const SizedBox(width: 8),
                GestureDetector(
                  key: const Key('review-note-add'),
                  onTap: onEditNote,
                  child: Container(
                    width: 24,
                    height: 24,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                    ),
                    child: const Text(
                      '+',
                      style: TextStyle(
                        fontFamily: systemFontFamily,
                        fontSize: 16,
                        fontWeight: FontWeight.w300,
                        color: AppColors.mediumEmphasis,
                      ),
                    ),
                  ),
                ),
              ],
              const Spacer(),
              if (hasNote && onEditNote != null)
                GestureDetector(
                  key: const Key('review-note-edit'),
                  onTap: onEditNote,
                  child: Container(
                    width: 24,
                    height: 24,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                    ),
                    child: SvgPicture.asset('assets/icons/editSquare.svg', width: 16, height: 16),
                  ),
                ),
            ],
          ),
          Text(note ?? '', style: ReviewText.serif(RnType.bodyMedium, AppColors.highEmphasis)),
        ],
      ),
    );
  }
}
