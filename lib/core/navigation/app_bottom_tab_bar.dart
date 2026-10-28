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
    // RN's `CustomTabBar` is `position: absolute, bottom: 0` with a fixed
    // `marginBottom: 30` and a fixed 60pt height; its `insets.bottom`
    // padding/margin only shuffles the icons *inside* that 60pt box, so on
    // iOS the pill sits 30pt above the screen edge, over the home
    // indicator. Android keeps the inset shift: this Flutter shell paints
    // edge-to-edge behind the system nav bar (3-button or gesture pill),
    // which would otherwise hide the pill.
    final isAndroid = Theme.of(context).platform == TargetPlatform.android;
    final bottomInset = isAndroid ? MediaQuery.of(context).padding.bottom : 0.0;
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
          // shadowColor black, shadowOpacity 0.1, offset (0, 1), radius 4.
          boxShadow: const [
            BoxShadow(color: Color(0x1A000000), offset: Offset(0, 1), blurRadius: 4),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            for (var i = 0; i < visibleTabs.length; i++)
              Expanded(
                // RN's TouchableOpacity: no Material ripple.
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
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
    final icon = SizedBox(
      width: 24,
      height: 24,
      child: SvgPicture.asset(
        focused ? tab.activeIconAsset : tab.inactiveIconAsset,
      ),
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
