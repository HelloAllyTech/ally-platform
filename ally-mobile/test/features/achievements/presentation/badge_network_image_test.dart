import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/achievements/presentation/badge_network_image.dart';

void main() {
  test('SVG badge URLs are recognised by extension, case-insensitively (RN isSvg)', () {
    expect(BadgeNetworkImage.isSvgUrl('https://cdn.example/badges/first-steps.SVG'), isTrue);
    expect(BadgeNetworkImage.isSvgUrl('https://cdn.example/badges/first-steps.svg'), isTrue);
    expect(BadgeNetworkImage.isSvgUrl('https://cdn.example/badges/first-steps.png'), isFalse);
  });

  testWidgets('bitmap badge URLs stay bitmaps', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: BadgeNetworkImage(url: 'https://cdn.example/badges/first-steps.png', width: 60, height: 60),
      ),
    );
    expect(find.byType(SvgPicture), findsNothing);
    expect(find.byType(Image), findsOneWidget);
  });
}
