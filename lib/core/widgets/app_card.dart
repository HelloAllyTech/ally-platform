import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_radius.dart';

/// ally-mobile (React Native) has no single generic `Card` primitive —
/// this ports the two real recurring patterns found under
/// `src/components/`, selected via [AppCardVariant]:
///
/// - [AppCardVariant.elevated]: `SimulationCard`'s look — white, radius 24,
///   0.5px `strokePrimary` hairline border, soft drop shadow. The more
///   broadly reused "list item card" shape; the default.
/// - [AppCardVariant.flat]: `ResourceArticleCard`'s look — white, radius 8,
///   0.5px `lightGray14` hairline border, no shadow at all.
enum AppCardVariant { elevated, flat }

class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.variant = AppCardVariant.elevated});

  final Widget child;
  final AppCardVariant variant;

  @override
  Widget build(BuildContext context) {
    return switch (variant) {
      AppCardVariant.elevated => Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.xl3),
            border: Border.all(color: AppColors.strokePrimary, width: 0.5),
            boxShadow: [
              BoxShadow(
                color: AppColors.onBackground.withValues(alpha: 0.2),
                offset: const Offset(0, 2),
                blurRadius: 3,
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: child,
        ),
      AppCardVariant.flat => Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: AppColors.lightGray14, width: 0.5),
          ),
          child: child,
        ),
    };
  }
}
