import 'package:ally_mobile_flutter/core/theme/app_fonts.dart';
import 'package:ally_mobile_flutter/core/theme/rn_scale.dart';
import 'package:ally_mobile_flutter/core/widgets/custom_dropdown.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';

const _itemStyle = TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14);

Future<void> _pump(WidgetTester tester) async {
  tester.view.physicalSize = const Size(402, 874);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => RnScale(child: child!),
      home: Scaffold(
        body: Center(
          child: CustomDropdown(
            key: const Key('dropdown'),
            menuKey: const Key('menu'),
            value: 'Last 7 days',
            options: const ['Last 7 days', 'All time'],
            onSelect: (_) {},
            fixedWidth: 120,
            headerTextStyle: _itemStyle,
            itemTextStyle: _itemStyle,
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('fixedWidth and the arrow are RN plain numbers, not scaled by RnScale', (tester) async {
    await _pump(tester);

    // RN `fixedWidth={120}` / `<ArrowDown width={6} />`: screen points on a
    // 402pt iPhone, where RnScale would otherwise grow them ~7.4%.
    expect(tester.getRect(find.byKey(const Key('dropdown'))).width, closeTo(120, 0.01));
    expect(tester.getRect(find.byType(SvgPicture)).width, closeTo(6, 0.01));
  });

  testWidgets('the selected option renders in IBM Plex Serif Medium, as RN resolves weight 500', (tester) async {
    await _pump(tester);
    await tester.tap(find.byKey(const Key('dropdown')));
    await tester.pumpAndSettle();

    final menu = find.byKey(const Key('menu'));
    Text option(String label) => tester.widget<Text>(find.descendant(of: menu, matching: find.text(label)));
    expect(option('Last 7 days').style!.fontFamily, AppFonts.ibmPlexSerifMedium);
    expect(option('Last 7 days').style!.fontWeight, FontWeight.w500);
    expect(option('All time').style!.fontFamily, AppFonts.ibmPlexSerifRegular);
  });
}
