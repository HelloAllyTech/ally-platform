import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/rn_scale.dart';

/// RN's `InfoTooltip` — a tap-to-show info bubble. Ported via Flutter's own
/// `Tooltip` in tap-trigger mode rather than a custom popover, since that
/// already covers the same "tap the (i) icon, see explanatory text" need.
/// Shared by AchievementsScreen (per-category tooltips) and
/// `TabScreenHeader` (the title-row tooltip RN's `isTooltipRequired`/
/// `tooltipContent` props drive, e.g. LeaderboardScreen's).
///
/// The icon is RN's `InfoIcon` (`assets/icons/info.svg`) at
/// `width={16} height={16}` (unscaled). Its `color` prop has no effect in
/// RN: the SVG's fill is hardcoded (#1C1B1F), so none is applied here.
class InfoTooltipIcon extends StatelessWidget {
  const InfoTooltipIcon({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final size = RnSize.of(context).raw(16);
    return Tooltip(
      message: message,
      triggerMode: TooltipTriggerMode.tap,
      child: SizedBox(
        width: size,
        height: size,
        child: SvgPicture.asset('assets/icons/info.svg'),
      ),
    );
  }
}
