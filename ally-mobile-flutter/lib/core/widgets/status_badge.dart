import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `src/screens/CallLog/
/// components/StatusBadge/StatusBadge.tsx` + `SUMMARY_STATUS_CONFIG` —
/// a pastel-background pill with a small colored status dot, not a
/// solid-color/white-text badge. The label text color is constant
/// (`highEmphasis`) across every status; only the background and dot are
/// status-colored. `label` is intentionally NOT translated here, matching
/// the RN source exactly — `config.label` is used as literal English text
/// there too (a real, if odd, RN inconsistency, not a port mistake).
enum ChatSummaryStatus { pending, inProgress, success, failed, noAudio, unknown }

ChatSummaryStatus chatSummaryStatusFromString(String value) => switch (value.toUpperCase()) {
      'PENDING' => ChatSummaryStatus.pending,
      'IN_PROGRESS' => ChatSummaryStatus.inProgress,
      'SUCCESS' => ChatSummaryStatus.success,
      'FAILED' => ChatSummaryStatus.failed,
      'NO_AUDIO' => ChatSummaryStatus.noAudio,
      _ => ChatSummaryStatus.unknown,
    };

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status, this.noAudioLabel = 'No Audio'});

  final ChatSummaryStatus status;

  /// Unlike every other status's label, RN's "No Audio" case does go
  /// through `t('calls.status.noAudio')` — pass the translated string in.
  final String noAudioLabel;

  static const _config = {
    ChatSummaryStatus.pending: (bg: AppColors.creamYellow, dot: AppColors.amberOrange, label: 'Processing'),
    ChatSummaryStatus.inProgress: (
      bg: AppColors.creamYellow,
      dot: AppColors.amberOrange,
      label: 'Processing',
    ),
    ChatSummaryStatus.success: (bg: AppColors.mintGreen, dot: AppColors.emeraldGreen, label: 'Generated'),
    ChatSummaryStatus.failed: (bg: AppColors.coralPink, dot: AppColors.brickRed, label: 'Error'),
  };

  // RN's own styles.statusText: `fontFamily: IBM_PLEX_SERIF.REGULAR` +
  // `typography.label.micro` (fontSize 9, lineHeight 10, letterSpacing
  // 0.09) — a bespoke size with no equivalent Flutter TextTheme slot
  // (labelSmall is 11/16/0.5), so this is its own explicit style rather
  // than a theme-slot copyWith.
  static const _textStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 9,
    height: 10 / 9,
    letterSpacing: 0.09,
    color: AppColors.highEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    const textStyle = _textStyle;

    if (status == ChatSummaryStatus.noAudio) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(12)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset('assets/icons/hexagonClose.svg', width: 12, height: 12),
            const SizedBox(width: 4),
            Text(noAudioLabel, style: textStyle),
          ],
        ),
      );
    }

    final config = _config[status];
    if (config == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: config.bg, borderRadius: BorderRadius.circular(12)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 4,
            height: 4,
            decoration: BoxDecoration(color: config.dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 4),
          Text(config.label, style: textStyle),
        ],
      ),
    );
  }
}
