import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/sized_network_image.dart';

Future<Uint8List> _png(int width, int height) async {
  final recorder = ui.PictureRecorder();
  Canvas(recorder).drawRect(Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()), Paint()..color = Colors.red);
  final image = await recorder.endRecording().toImage(width, height);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  return data!.buffer.asUint8List();
}

Future<Size> _decodedSize(ImageProvider provider) async {
  final completer = Completer<Size>();
  final stream = provider.resolve(ImageConfiguration.empty);
  late final ImageStreamListener listener;
  listener = ImageStreamListener(
    (info, _) {
      completer.complete(Size(info.image.width.toDouble(), info.image.height.toDouble()));
      stream.removeListener(listener);
    },
    onError: (Object error, _) => completer.completeError(error),
  );
  stream.addListener(listener);
  return completer.future;
}

void main() {
  testWidgets('decodes just large enough to cover the box, keeping the aspect ratio', (tester) async {
    await tester.runAsync(() async {
      final bytes = await _png(200, 100);
      // Cover 50x50: scale = max(50/200, 50/100) = 0.5.
      expect(await _decodedSize(decodeSizedImage(MemoryImage(bytes), width: 50, height: 50)), const Size(100, 50));
      // Only a width: scale 0.25.
      expect(await _decodedSize(decodeSizedImage(MemoryImage(bytes), width: 50)), const Size(50, 25));
      // Never upscales.
      expect(await _decodedSize(decodeSizedImage(MemoryImage(bytes), width: 400, height: 400)), const Size(200, 100));
    });
  });

  test('no size leaves the provider untouched', () {
    final provider = MemoryImage(Uint8List(0));
    expect(identical(decodeSizedImage(provider), provider), isTrue);
  });

  testWidgets('passes layout params through and sizes from constraints when not given', (tester) async {
    await tester.pumpWidget(
      const MediaQuery(
        data: MediaQueryData(devicePixelRatio: 3),
        child: Center(
          child: SizedBox(
            width: 40,
            height: 20,
            child: SizedNetworkImage('https://example.com/a.png', fit: BoxFit.cover),
          ),
        ),
      ),
    );
    final image = tester.widget<Image>(find.byType(Image));
    expect(image.fit, BoxFit.cover);
    expect(image.width, isNull);
    expect(image.height, isNull);
    expect(image.image.toString(), contains('_CoverResizeImage'));
    // Drain the (failing, offline) network load.
    await tester.pump();
    tester.takeException();
  });
}
