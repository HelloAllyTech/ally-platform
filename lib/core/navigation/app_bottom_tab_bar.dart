import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_colors.dart';
import 'tab_config.dart';

/// Direct port of ally-mobile (React Native)'s `TabNavigator.tsx` custom
/// `tabBar` render prop — a floating, pill-shaped bottom bar (not a stock
/// Material `BottomNavigationBar`), positioned absolutely over the screen
/// content rather than docked in the `Scaffold`'s own bottom-bar slot.
class AppBottomTabBar extends StatelessWidget {
  const AppBottomTabBar({
    super.key,
    required this.visibleTabs,
    required this.currentIndex,
    required this.onTap,
    required this.hasUnreadReviews,
  });

  final List<TabConfig> visibleTabs;
  final int currentIndex;
  final ValueChanged<int> onTap;
  final bool hasUnreadReviews;

  @override
  Widget build(BuildContext context) {
    // This bar sits in a `Positioned` inside the shell's full-bleed `Stack`,
    // which paints behind the Android system nav bar (3-button or gesture
    // pill) — `bottom: 30` alone measures from the absolute screen edge, so
    // the pill ends up partly or fully hidden behind it. Shifting the whole
    // pill up by the bottom inset (not padding its *inside*, which only grew
    // the box downward into the unsafe zone while squeezing the icons) is
    // what actually clears it, matching RN's `CustomTabBar`'s own
    // `marginTop: insets.bottom` nudge on top of its fixed `marginBottom: 30`.
    final bottomInset = MediaQuery.of(context).padding.bottom;
    // RN's `< 3` narrows the pill with wider side margins when there are
    // only 1-2 visible tabs, so it doesn't stretch edge-to-edge.
    final horizontalMargin = visibleTabs.length < 3 ? 80.0 : 40.0;

    return Positioned(
      left: horizontalMargin,
      right: horizontalMargin,
      bottom: 30 + bottomInset,
      child: Container(
        height: 60,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(40),
          border: Border.all(color: AppColors.lightGray2, width: 0.5),
          boxShadow: const [
            BoxShadow(color: Colors.black12, offset: Offset(0, 1), blurRadius: 4),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            for (var i = 0; i < visibleTabs.length; i++)
              Expanded(
                child: InkWell(
                  onTap: () => onTap(i),
                  child: Center(
                    child: _TabIcon(
                      tab: visibleTabs[i],
                      focused: i == currentIndex,
                      showUnreadDot: visibleTabs[i].name == kTabReview && hasUnreadReviews,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TabIcon extends StatelessWidget {
  const _TabIcon({required this.tab, required this.focused, required this.showUnreadDot});

  final TabConfig tab;
  final bool focused;
  final bool showUnreadDot;

  @override
  Widget build(BuildContext context) {
    final icon = SvgPicture.asset(
      focused ? tab.activeIconAsset : tab.inactiveIconAsset,
      width: 24,
      height: 24,
    );
    if (!showUnreadDot) return icon;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        icon,
        Positioned(
          top: 0,
          right: 0,
          child: Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
          ),
        ),
      ],
    );
  }
}
