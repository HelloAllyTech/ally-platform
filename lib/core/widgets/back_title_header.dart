import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';

/// The back-arrow + "Plain *Italic*" title header that RN's pushed screens
/// draw for themselves (19 screens use `LeftArrowIcon`, each with its own
/// `header` style). Defaults are SimulationDetailsScreen's exact values;
/// screens whose RN header spaces things differently pass their own.
///
/// Pads for the status bar itself: these screens are pushed outside the tab
/// shell's `SafeArea`, which is how Start Role-play ended up drawing its
/// title over the clock.
class BackTitleHeader extends StatelessWidget {
  const BackTitleHeader({
    super.key,
    required this.title,
    this.italicTitle,
    this.onBack,
    this.trailing,
    this.margin = const EdgeInsets.only(left: 10, right: 10, bottom: 18),
    this.padding = const EdgeInsets.only(top: 16, bottom: 8),
    this.gap = 8,
    this.borderColor = AppColors.lightGray5,
  });

  final String title;

  /// RN's nested `pageTitleItalic` span, appended after a space.
  final String? italicTitle;

  /// Defaults to popping the route, as RN's `navigation.goBack()` does.
  final VoidCallback? onBack;
  final Widget? trailing;
  final EdgeInsets margin;
  final EdgeInsets padding;
  final double gap;
  final Color? borderColor;

  static const _titleStyle = TextStyle(
    fontFamily: AppFonts.replayProHeadline,
    fontSize: 18,
    height: 24 / 18,
    letterSpacing: 0.18,
    fontWeight: FontWeight.w300,
    color: AppColors.highEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top),
      child: Container(
        margin: margin,
        padding: padding,
        decoration: borderColor == null
            ? null
            : BoxDecoration(border: Border(bottom: BorderSide(color: borderColor!, width: 0.5))),
        child: Row(
          children: [
            Semantics(
              button: true,
              label: MaterialLocalizations.of(context).backButtonTooltip,
              child: GestureDetector(
                key: const Key('back-title-header-back'),
                behavior: HitTestBehavior.opaque,
                onTap: onBack ?? () => context.pop(),
                child: SvgPicture.asset(
                  'assets/icons/leftArrowIcon.svg',
                  colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
                ),
              ),
            ),
            SizedBox(width: gap),
            Expanded(
              child: Text.rich(
                TextSpan(
                  text: title,
                  style: _titleStyle,
                  children: [
                    if (italicTitle != null)
                      TextSpan(
                        text: ' $italicTitle',
                        style: const TextStyle(
                          fontFamily: AppFonts.replayProBoldItalic,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                  ],
                ),
              ),
            ),
            ?trailing,
          ],
        ),
      ),
    );
  }
}
