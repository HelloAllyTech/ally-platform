import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/widgets/app_tab_view.dart';

/// RN's `TabView` with `tabWidthMode="content"`, as the Learn tab uses it:
/// each tab is sized to its one-line label (`flexShrink: 0`) and the leftover
/// width is shared out equally (`flexGrow: 1`), so "Learning Pathways" gets
/// the room it needs instead of wrapping inside a quarter-width slot.
///
/// The shared [AppTabView] only implements RN's default `'equal'` mode; this
/// is the `'content'` mode, kept local to the one screen that uses it.
class LearnTabView<T> extends StatelessWidget {
  const LearnTabView({
    super.key,
    required this.tabs,
    required this.activeTab,
    required this.onTabChange,
  });

  final List<AppTabViewItem<T>> tabs;
  final T activeTab;
  final ValueChanged<T> onTabChange;

  // styles.tabText: IBM_PLEX_SERIF.REGULAR + typography.label.medium.
  static const _labelStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 12,
    height: 20 / 12,
    letterSpacing: 0.2,
  );

  // styles.tab: paddingHorizontal 4 on each side.
  static const _horizontalPadding = 4.0;
  static const _containerBorder = 0.5;

  @override
  Widget build(BuildContext context) {
    final textScaler = MediaQuery.textScalerOf(context);
    final textDirection = Directionality.of(context);

    return Container(
      decoration: BoxDecoration(
        color: AppColors.lightGray19,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.lightGray4, width: _containerBorder),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final contentWidths = [
            for (final tab in tabs)
              (TextPainter(
                    text: TextSpan(text: tab.label, style: _labelStyle),
                    textDirection: textDirection,
                    textScaler: textScaler,
                    maxLines: 1,
                  )..layout())
                  .width
                  .ceilToDouble() +
                  2 * _horizontalPadding +
                  // the active tab's 0.5px border on each side
                  1,
          ];
          final total = contentWidths.fold<double>(0, (a, b) => a + b);
          final spare = constraints.maxWidth - total;
          final fits = spare >= 0;
          final extra = fits && tabs.isNotEmpty ? spare / tabs.length : 0.0;

          return Row(
            children: [
              for (var i = 0; i < tabs.length; i++)
                if (fits)
                  SizedBox(
                    width: contentWidths[i] + extra,
                    child: _tab(tabs[i]),
                  )
                else
                  // RN would overflow its container here; ellipsize instead.
                  Expanded(child: _tab(tabs[i])),
            ],
          );
        },
      ),
    );
  }

  Widget _tab(AppTabViewItem<T> tab) {
    final isActive = tab.key == activeTab;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onTabChange(tab.key),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: _horizontalPadding),
        alignment: Alignment.center,
        decoration: isActive
            ? BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(7),
                border: Border.all(color: AppColors.lightGray2, width: 0.5),
              )
            : null,
        child: Text(
          tab.label,
          maxLines: 1,
          softWrap: false,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: _labelStyle.copyWith(
            color: isActive ? AppColors.highEmphasis : AppColors.mediumEmphasis,
          ),
        ),
      ),
    );
  }
}
