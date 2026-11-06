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
    final radius = variant == AppCardVariant.elevated ? AppRadius.xl3 : AppRadius.lg;
    final borderColor = variant == AppCardVariant.elevated
        ? AppColors.strokePrimary
        : AppColors.lightGray14;

    // The surface color lives on an inner `Material`, not this `Container`'s
    // own decoration — any interactive descendant (a `ListTile`, an
    // `InkWell`) paints its splashes on the nearest `Material` ancestor,
    // and a `DecoratedBox`-painted background in between hides them
    // (Flutter's own Card widget does the same split for this reason).
    // The border/shadow stay on the outer `Container` since `Material`'s
    // own `elevation` shadow isn't the same shape as the real app's
    // `boxShadow` spec.
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor, width: 0.5),
        boxShadow: variant == AppCardVariant.elevated
            ? [
                BoxShadow(
                  color: AppColors.onBackground.withValues(alpha: 0.2),
                  offset: const Offset(0, 2),
                  blurRadius: 3,
                ),
              ]
            : null,
      ),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(radius),
        clipBehavior: Clip.antiAlias,
        child: child,
      ),
    );
  }
}
