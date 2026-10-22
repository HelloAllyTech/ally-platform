import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// RN's `InfoTooltip` — a tap-to-show info bubble. Ported via Flutter's own
/// `Tooltip` in tap-trigger mode rather than a custom popover, since that
/// already covers the same "tap the (i) icon, see explanatory text" need.
/// Shared by AchievementsScreen (per-category tooltips) and
/// `TabScreenHeader` (the title-row tooltip RN's `isTooltipRequired`/
/// `tooltipContent` props drive, e.g. LeaderboardScreen's).
class InfoTooltipIcon extends StatelessWidget {
  const InfoTooltipIcon({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: message,
      triggerMode: TooltipTriggerMode.tap,
      child: const Icon(
        Icons.info_outline,
        size: 16,
        color: AppColors.mediumEmphasis,
      ),
    );
  }
}
