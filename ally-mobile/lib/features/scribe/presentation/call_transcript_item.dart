import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';

/// Port of ally-mobile (React Native)'s `CallTranscriptItem`
/// (`src/screens/CallSummaryScreen/components/CallTranscriptItem/
/// CallTranscriptItem.tsx`) — lives outside `ListeningScreen/` in RN but is
/// reused here for Scribe's live transcript, same as RN does.
///
/// Scoped to the two colors this screen actually uses ([counselor] true/
/// false) — RN's `isDictation` white variant belongs to a different screen
/// this port doesn't render transcripts for, so it isn't modeled. Color
/// tokens are this app's nearest existing equivalents to RN's
/// `ds.blueAlpha[25]`/`ds.deepPurpleAlpha[25]` tints (not yet ported as
/// their own named tokens) rather than new exact-hex additions.
class CallTranscriptItem extends StatelessWidget {
  const CallTranscriptItem({
    super.key,
    required this.time,
    required this.message,
    this.speakerLabel,
    this.counselor = false,
  });

  final String time;
  final String message;
  final String? speakerLabel;
  final bool counselor;

  @override
  Widget build(BuildContext context) {
    final backgroundColor = counselor ? AppColors.blue50 : AppColors.deepPurple50;
    final accentColor = counselor ? AppColors.primary : AppColors.deepPurple400;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: backgroundColor,
        border: Border.all(color: accentColor, width: 0.5),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                '$time ',
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 13,
                  color: AppColors.mediumEmphasis,
                  letterSpacing: 0.1,
                ),
              ),
              if (speakerLabel != null)
                Text(
                  speakerLabel!,
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 13,
                    color: accentColor,
                    letterSpacing: 0.25,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            message,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 13,
              color: AppColors.highEmphasis,
              letterSpacing: 0.25,
              height: 20 / 13,
            ),
          ),
        ],
      ),
    );
  }
}
