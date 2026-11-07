import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/navigation/screen_focus_listener.dart';

void main() {
  testWidgets('fires when a pushed route pops back, not on first mount', (tester) async {
    var focuses = 0;
    final navigatorKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: navigatorKey,
      home: ScreenFocusListener(onFocus: () => focuses++, child: const Text('list')),
    ));
    await tester.pumpAndSettle();
    expect(focuses, 0);

    navigatorKey.currentState!.push(MaterialPageRoute<void>(builder: (_) => const Text('details')));
    await tester.pumpAndSettle();
    expect(focuses, 0);

    navigatorKey.currentState!.pop();
    await tester.pumpAndSettle();
    expect(focuses, 1);
  });

  testWidgets('fires when its IndexedStack tab is selected again', (tester) async {
    var focuses = 0;
    Widget shell(int index) => MaterialApp(
          home: IndexedStack(
            index: index,
            children: [
              ScreenFocusListener(onFocus: () => focuses++, child: const Text('tab 0')),
              const Text('tab 1'),
            ],
          ),
        );
    await tester.pumpWidget(shell(0));
    await tester.pumpWidget(shell(1));
    await tester.pump();
    expect(focuses, 0);
    await tester.pumpWidget(shell(0));
    await tester.pump();
    expect(focuses, 1);
  });

  testWidgets('a dialog or popup over the screen is not a blur (RN Modal)', (tester) async {
    var focuses = 0;
    final navigatorKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: navigatorKey,
      home: ScreenFocusListener(onFocus: () => focuses++, child: const Text('list')),
    ));
    showDialog<void>(context: navigatorKey.currentContext!, builder: (_) => const Text('dialog'));
    await tester.pumpAndSettle();
    navigatorKey.currentState!.pop();
    await tester.pumpAndSettle();
    expect(focuses, 0);
  });
}
