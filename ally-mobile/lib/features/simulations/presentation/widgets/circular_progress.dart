import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';

/// Port of ally-mobile (React Native)'s `src/components/CircularProgress/
/// CircularProgress.tsx` — a grey track circle with a round-capped arc
/// starting at 12 o'clock, animated from empty to [progress]/[max] over
/// 1200ms (`Easing.out(Easing.cubic)`), with optional centred [child].
class CircularProgress extends StatelessWidget {
  const CircularProgress({
    super.key,
    required this.progress,
    this.max = 100,
    this.size = 32,
    this.strokeWidth = 3,
    this.progressColor = AppColors.legacyBlue,
    this.trackColor = AppColors.grey100,
    this.animationDuration = const Duration(milliseconds: 1200),
    this.child,
  });

  final num progress;
  final num max;
  final double size;
  final double strokeWidth;
  final Color progressColor;
  final Color trackColor;
  final Duration animationDuration;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final fraction = max == 0 ? 0.0 : (progress / max).clamp(0, 1).toDouble();
    return SizedBox(
      width: size,
      height: size,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: fraction),
        duration: animationDuration,
        curve: Curves.easeOutCubic,
        builder: (context, value, child) => CustomPaint(
          painter: _RingPainter(
            fraction: value,
            // RN only draws the arc at all when the target is above zero.
            drawArc: fraction > 0,
            strokeWidth: strokeWidth,
            progressColor: progressColor,
            trackColor: trackColor,
          ),
          child: child,
        ),
        child: child == null ? null : Center(child: child),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({
    required this.fraction,
    required this.drawArc,
    required this.strokeWidth,
    required this.progressColor,
    required this.trackColor,
  });

  final double fraction;
  final bool drawArc;
  final double strokeWidth;
  final Color progressColor;
  final Color trackColor;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final radius = (size.shortestSide - strokeWidth) / 2;
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..color = trackColor,
    );
    if (!drawArc || fraction <= 0) return;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      2 * math.pi * fraction,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round
        ..color = progressColor,
    );
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.fraction != fraction ||
      old.drawArc != drawArc ||
      old.strokeWidth != strokeWidth ||
      old.progressColor != progressColor ||
      old.trackColor != trackColor;
}
