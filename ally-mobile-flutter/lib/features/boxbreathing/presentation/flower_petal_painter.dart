import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Direct port of ally-mobile (React Native)'s `FlowerPetal` SVG component —
/// 5 petals, each a pair of cubic bezier curves from the flower's center out
/// to a tip and back, rotated about the center by `angle * bloomProgress`
/// degrees (so the petals visually "unfold" outward as the breathing cycle
/// blooms, rather than just scaling or fading in place) with an opacity that
/// ramps alongside `bloomProgress` (capped contribution at 0.6, same as the
/// original). A gray semicircular "stem" sits underneath, static regardless
/// of bloom state.
///
/// Like the real component, the bezier control points (-35,-40 / -35,-100 /
/// 0,-140 / etc.) are fixed offsets from the canvas center, NOT scaled to
/// the `size` it's given — RN's `<Svg viewBox="0 0 size size">` maps 1:1,
/// so a smaller flower box only moves the center, never shrinks the petals.
class FlowerPetalPainter extends CustomPainter {
  const FlowerPetalPainter({required this.bloomProgress});

  final double bloomProgress;

  static const List<double> _petalAngles = [0, -65, -35, 65, 35];

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final opacity = (0.2 + math.min(bloomProgress, 0.6)).clamp(0.0, 1.0);

    for (final angleDeg in _petalAngles) {
      final radians = angleDeg * bloomProgress * math.pi / 180;
      final path = _petalPath(center, radians);
      final bounds = path.getBounds();

      canvas.saveLayer(bounds.inflate(4), Paint()..color = Colors.white.withValues(alpha: opacity));
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.fill
          ..shader = const RadialGradient(
            center: Alignment(0, -0.6),
            radius: 0.9,
            colors: [Color(0x33FFFFFF), Color(0xFFBBBBBB)],
          ).createShader(bounds),
      );
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 0.5
          ..color = Colors.black.withValues(alpha: 0.3),
      );
      canvas.restore();
    }

    _paintStem(canvas, center);
  }

  /// `M cx,cy C t(-35,-40) t(-35,-100) t(0,-140) C t(35,-100) t(35,-40) cx,cy
  /// Z`, where `t(x, y)` rotates the point by `radians` about [center].
  Path _petalPath(Offset center, double radians) {
    final cos = math.cos(radians);
    final sin = math.sin(radians);
    Offset t(double x, double y) =>
        Offset(x * cos - y * sin + center.dx, x * sin + y * cos + center.dy);

    final c1 = t(-35, -40);
    final c2 = t(-35, -100);
    final tip = t(0, -140);
    final c3 = t(35, -100);
    final c4 = t(35, -40);

    return Path()
      ..moveTo(center.dx, center.dy)
      ..cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, tip.dx, tip.dy)
      ..cubicTo(c3.dx, c3.dy, c4.dx, c4.dy, center.dx, center.dy)
      ..close();
  }

  /// `M cx-20,cy+20 A 20,20 0 0,0 cx+20,cy+20 Z`, rotated 180° about
  /// `(cx, cy+15)` — a static gray semicircle anchoring the flower's base.
  void _paintStem(Canvas canvas, Offset center) {
    final pivot = Offset(center.dx, center.dy + 15);
    final stem = Path()
      ..moveTo(center.dx - 20, center.dy + 20)
      ..arcToPoint(
        Offset(center.dx + 20, center.dy + 20),
        radius: const Radius.circular(20),
        clockwise: false,
      )
      ..close();
    final matrix = Matrix4.identity()
      ..translateByDouble(pivot.dx, pivot.dy, 0, 1)
      ..rotateZ(math.pi)
      ..translateByDouble(-pivot.dx, -pivot.dy, 0, 1);
    canvas.drawPath(
      stem.transform(matrix.storage),
      Paint()..color = const Color(0xFFC5C5C5),
    );
  }

  @override
  bool shouldRepaint(covariant FlowerPetalPainter oldDelegate) =>
      oldDelegate.bloomProgress != bloomProgress;
}
