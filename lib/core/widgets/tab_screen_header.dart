import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/
/// TabScreenHeader/TabScreenHeader.tsx` — the shared title+subtitle header
/// used across most tab-root screens. Single row, space-between: title
/// (with an optional nested, differently-weighted/italic subtitle) on the
/// left, caller-supplied trailing content (credits display, badges
/// button, etc.) on the right.
class TabScreenHeader extends StatelessWidget {
  const TabScreenHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.italicSubtitle = false,
    this.trailing,
    this.showBorder = true,
  });

  final String title;
  final String? subtitle;
  final bool italicSubtitle;
  final Widget? trailing;
  final bool showBorder;

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
          Expanded(
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
          ?trailing,
        ],
      ),
    );
  }
}
