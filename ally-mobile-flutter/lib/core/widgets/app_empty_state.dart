import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/EmptyState/
/// EmptyState.tsx` — icon + title + (optional) description, used across
/// most screens' "no data" states. Matches the RN source's own
/// title/description alignment asymmetry: title is left-aligned (no
/// `textAlign` set in the original), only the description is centered.
///
/// RN takes the icon as an SVG component and renders it at its default
/// `iconProps` of 160x130 (`ms(160)`/`ms(130)`) unless the caller passes
/// others — pass [iconAsset] (and optionally [iconWidth]/[iconHeight]) for
/// that. [icon] stays for callers that need an arbitrary widget.
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    this.icon,
    this.iconAsset,
    this.iconWidth = 160,
    this.iconHeight = 130,
    required this.title,
    this.description,
  });

  final Widget? icon;
  final String? iconAsset;
  final double iconWidth;
  final double iconHeight;
  final String title;
  final String? description;

  @override
  Widget build(BuildContext context) {
    final iconWidget =
        icon ?? (iconAsset != null ? SizedBox(
          width: iconWidth,
          height: iconHeight,
          child: SvgPicture.asset(iconAsset!),
        ) : null);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        if (iconWidget != null) Padding(padding: const EdgeInsets.only(bottom: 28), child: iconWidget),
        Text(
          title,
          style: const TextStyle(
            fontFamily: AppFonts.ibmPlexSerifMedium,
            fontSize: 20,
            height: 24 / 20,
            color: AppColors.darkGray2,
          ),
        ),
        if (description != null && description!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Text(
              description!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                height: 24 / 14,
                color: AppColors.darkGray2,
              ),
            ),
          ),
      ],
    );
  }
}
