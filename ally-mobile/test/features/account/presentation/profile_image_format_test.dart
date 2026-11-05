import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/account/presentation/profile_settings_screen.dart';

void main() {
  test('only jpeg/png pass as-is (RN restrictMimeTypes)', () {
    expect(isJpegOrPngPath('/tmp/a.JPG'), isTrue);
    expect(isJpegOrPngPath('/tmp/a.jpeg'), isTrue);
    expect(isJpegOrPngPath('/tmp/a.png'), isTrue);
    expect(isJpegOrPngPath('/tmp/a.gif'), isFalse);
    expect(isJpegOrPngPath('/tmp/a.heic'), isFalse);
  });

  test('anything else is re-encoded as PNG', () async {
    final gif = base64Decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    final png = await encodeAsPng(gif);
    expect(png, isNotNull);
    expect(png!.sublist(1, 4), utf8.encode('PNG'));
  });
}
