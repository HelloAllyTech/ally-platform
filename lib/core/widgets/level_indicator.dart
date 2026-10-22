import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/
/// LevelIndicator/LevelIndicator.tsx` — a compact level ring for the
/// persistent header slot. RN reuses its own `CircularProgress` component;
/// Flutter's `CircularProgressIndicator` already covers the same "ring with
/// centered content" need, matching the course-progress rings elsewhere in
/// this app (e.g. CourseProgressScreen's skill-category rows).
class LevelIndicator extends StatelessWidget {
  const LevelIndicator({
    super.key,
    required this.level,
    required this.progress,
    this.isMaxLevel = false,
    required this.semanticLabel,
    this.onTap,
  });

  final int level;

  /// 0..1 fill toward the next level.
  final double progress;

  /// At the top of the ladder the ring is permanently full and switches
  /// colour.
  final bool isMaxLevel;

  /// Full sentence for assistive tech — a ring and a bare number say
  /// nothing alone.
  final String semanticLabel;
  final VoidCallback? onTap;

  static const _ringSize = 33.0;
  static const _ringStroke = 3.0;

  @override
  Widget build(BuildContext context) {
    final safeProgress = progress.isFinite ? progress.clamp(0.0, 1.0) : 0.0;

    return Semantics(
      label: semanticLabel,
      button: onTap != null,
      image: onTap == null,
      child: GestureDetector(
        onTap: onTap,
        child: SizedBox(
          key: const ValueKey('level-indicator'),
          width: _ringSize,
          height: _ringSize,
          child: Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: _ringSize,
                height: _ringSize,
                child: CircularProgressIndicator(
                  value: safeProgress,
                  strokeWidth: _ringStroke,
                  backgroundColor: AppColors.lightGray2,
                  valueColor: AlwaysStoppedAnimation(
                    isMaxLevel ? Colors.green : AppColors.primary,
                  ),
                ),
              ),
              Text(
                '$level',
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifMedium,
                  fontSize: 12,
                  color: AppColors.highEmphasis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
