import 'package:flutter/material.dart';

import '../../features/progress/presentation/progress_header_widget.dart';
import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';
import 'info_tooltip_icon.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/
/// TabScreenHeader/TabScreenHeader.tsx` — the shared title+subtitle header
/// used across most tab-root screens. Single row, space-between: title
/// (with an optional nested, differently-weighted/italic subtitle) and an
/// optional info tooltip on the left, the always-on level indicator plus
/// caller-supplied trailing content (credits display, badges button, etc.)
/// on the right.
class TabScreenHeader extends StatelessWidget {
  const TabScreenHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.italicSubtitle = false,
    this.leading,
    this.trailing,
    this.showBorder = true,
    this.tooltip,
    this.hideProgressWidget = false,
  });

  final String title;
  final String? subtitle;
  final bool italicSubtitle;

  /// Matches the real header's hamburger-menu slot — reused here for any
  /// leading affordance, e.g. CallLogScreen's back button when viewing
  /// archived logs (`showBackButton` in the RN source).
  final Widget? leading;
  final Widget? trailing;
  final bool showBorder;

  /// RN's `isTooltipRequired`/`tooltipContent` — an info `(i)` icon right
  /// after the title, e.g. LeaderboardScreen's badge-earning explanation.
  final String? tooltip;

  /// RN's `ProgressHeaderWidget` is rendered by this shared header on every
  /// screen except the Progress screen itself — a widget that navigates to
  /// the screen you're already on would be a dead control next to a hero
  /// showing the same ring. ProgressScreen's own header call sets this true.
  final bool hideProgressWidget;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      margin: const EdgeInsets.only(top: 16),
      decoration: showBorder
          ? const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
            )
          : null,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          ?leading,
          if (leading != null) const SizedBox(width: 6),
          Expanded(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: title,
                          style: const TextStyle(
                            fontFamily: AppFonts.replayProHeadline,
                            fontSize: 18,
                            height: 24 / 18,
                            letterSpacing: 0.18,
                            fontWeight: FontWeight.w500,
                            color: AppColors.highEmphasis,
                          ),
                        ),
                        if (subtitle != null)
                          TextSpan(
                            text: ' $subtitle',
                            style: TextStyle(
                              fontFamily: italicSubtitle ? AppFonts.replayProBoldItalic : null,
                              fontWeight: FontWeight.w300,
                              fontStyle: italicSubtitle ? FontStyle.italic : FontStyle.normal,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                if (tooltip != null) ...[
                  const SizedBox(width: 6),
                  InfoTooltipIcon(message: tooltip!),
                ],
              ],
            ),
          ),
          // Rendered here rather than passed in per screen so it's genuinely
          // on every header, and so it doesn't compete with `trailing`,
          // which the busiest screens already use for credits/badge counts.
          ProgressHeaderWidget(isOnProgressScreen: hideProgressWidget),
          if (trailing != null) const SizedBox(width: 12),
          if (trailing != null) Flexible(child: trailing!),
        ],
      ),
    );
  }
}
