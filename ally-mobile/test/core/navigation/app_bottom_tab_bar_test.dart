import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/navigation/app_bottom_tab_bar.dart';
import 'package:ally_mobile_flutter/core/navigation/tab_config.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';

Future<void> _pump(WidgetTester tester, TargetPlatform platform, {ValueChanged<int>? onTap}) {
  final tabs = visibleTabsFor([UserPermissions.viewCallLogs, UserPermissions.viewCommunity]);
  return tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(platform: platform),
      home: MediaQuery(
        data: const MediaQueryData(size: Size(402, 874), padding: EdgeInsets.only(bottom: 34)),
        child: Stack(
          children: [
            AppBottomTabBar(
              visibleTabs: tabs,
              currentIndex: 0,
              hasUnreadReviews: false,
              onTap: onTap ?? (_) {},
            ),
          ],
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('iOS: the pill sits 30pt above the screen edge, like RN CustomTabBar', (tester) async {
    await _pump(tester, TargetPlatform.iOS);
    expect(tester.widget<Positioned>(find.byType(Positioned).first).bottom, 30);
  });

  testWidgets('Android: shifted up by the nav-bar inset', (tester) async {
    await _pump(tester, TargetPlatform.android);
    expect(tester.widget<Positioned>(find.byType(Positioned).first).bottom, 64);
  });

  testWidgets('tabs are plain taps (TouchableOpacity), no Material ripple', (tester) async {
    int? tapped;
    await _pump(tester, TargetPlatform.iOS, onTap: (i) => tapped = i);
    expect(find.byType(InkWell), findsNothing);
    await tester.tap(find.byType(GestureDetector).last);
    expect(tapped, isNotNull);
  });
}
