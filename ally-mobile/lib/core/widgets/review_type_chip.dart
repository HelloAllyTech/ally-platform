import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';
import '../theme/app_radius.dart';

enum ReviewType { simulation, scribe }

/// Direct port of ally-mobile (React Native)'s `src/components/
/// ReviewTypeChip/ReviewTypeChip.tsx` — a rounded-rect (radius.lg, not a
/// full pill, unlike StatusBadge) label distinguishing a simulation review
/// from a scribe review.
class ReviewTypeChip extends StatelessWidget {
  const ReviewTypeChip({super.key, required this.reviewType, required this.label});

  final ReviewType reviewType;

  /// The already-translated `review.feedCard.reviewType` string (e.g.
  /// "Simulation" / "Scribe") — capitalization/translation is the
  /// caller's job, this widget only owns the color.
  final String label;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (reviewType) {
      ReviewType.simulation => (AppColors.deepPurple50, AppColors.deepPurple400),
      ReviewType.scribe => (AppColors.orange50, AppColors.orange900),
    };

    return Container(
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AppRadius.lg)),
      child: Text(
        label,
        // RN's styles.chipText: IBM_PLEX_SERIF.MEDIUM + typography.body.small
        // — bodySmall already matches the size/line-height/letter-spacing
        // exactly, but defaults to the Regular weight, not Medium.
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: fg, fontFamily: AppFonts.ibmPlexSerifMedium),
      ),
    );
  }
}
