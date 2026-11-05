import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:lottie/lottie.dart';

import 'package:ally_mobile_flutter/core/routing/launch_splash.dart';

void main() {
  test('the splash animation parses and every embedded image decodes at its declared size', () async {
    final bytes = File(kSplashAnimationAsset).readAsBytesSync();
    // Shrunk from 7.9 MB by re-encoding the PNGs as lossless WebP.
    expect(bytes.length, lessThan(3 * 1024 * 1024));

    final composition = await LottieComposition.fromBytes(bytes);
    expect(composition.images, hasLength(8));
    for (final image in composition.images.values) {
      final data = Uri.parse(image.fileName).data!.contentAsBytes();
      final codec = await ui.instantiateImageCodec(data);
      final frame = await codec.getNextFrame();
      expect(frame.image.width, image.width, reason: image.id);
      expect(frame.image.height, image.height, reason: image.id);
    }
  });
}
