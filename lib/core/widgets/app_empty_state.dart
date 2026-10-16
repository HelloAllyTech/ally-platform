import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/EmptyState/
/// EmptyState.tsx` — icon + title + (optional) description, used across
/// most screens' "no data" states. Matches the RN source's own
/// title/description alignment asymmetry: title is left-aligned (no
/// `textAlign` set in the original), only the description is centered.
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    this.icon,
    required this.title,
    this.description,
  });

  final Widget? icon;
  final String title;
  final String? description;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        if (icon != null) Padding(padding: const EdgeInsets.only(bottom: 28), child: icon),
        Text(
          title,
          style: const TextStyle(
            fontFamily: 'IBMPlexSerif-Medium',
            fontSize: 20,
            height: 24 / 20,
            color: AppColors.darkGray2,
          ),
        ),
        if (description != null)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Text(
              description!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: 'IBMPlexSerif-Regular',
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
