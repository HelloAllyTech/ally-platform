import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/boxbreathing/presentation/flower_petal_painter.dart';

void _paint(double bloomProgress) {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  FlowerPetalPainter(bloomProgress: bloomProgress).paint(canvas, const Size(280, 280));
  recorder.endRecording().dispose();
}

void main() {
  test('paints without throwing at a closed, mid-bloom, and fully bloomed state', () {
    expect(() => _paint(0), returnsNormally);
    expect(() => _paint(0.5), returnsNormally);
    expect(() => _paint(1), returnsNormally);
  });

  test('paints without throwing when scaled to a smaller or larger square than its reference size', () {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final painter = FlowerPetalPainter(bloomProgress: 0.5);
    expect(() => painter.paint(canvas, const Size(120, 120)), returnsNormally);
    expect(() => painter.paint(canvas, const Size(400, 400)), returnsNormally);
    recorder.endRecording().dispose();
  });

  test('shouldRepaint is true only when bloomProgress actually changes', () {
    const a = FlowerPetalPainter(bloomProgress: 0.3);
    const b = FlowerPetalPainter(bloomProgress: 0.3);
    const c = FlowerPetalPainter(bloomProgress: 0.7);

    expect(a.shouldRepaint(b), isFalse);
    expect(a.shouldRepaint(c), isTrue);
  });
}
