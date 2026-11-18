import 'package:ally_mobile_flutter/core/widgets/back_title_header.dart';
import 'package:ally_mobile_flutter/core/widgets/tab_screen_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

Widget _pushedApp(Widget pushed, {EdgeInsets padding = EdgeInsets.zero}) {
  final router = GoRouter(
    initialLocation: '/details',
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => const Scaffold(body: Text('root-screen')),
        routes: [GoRoute(path: 'details', builder: (_, _) => Scaffold(body: pushed))],
      ),
    ],
  );
  return ProviderScope(
    child: MediaQuery(
      data: MediaQueryData(size: const Size(402, 874), padding: padding),
      child: MaterialApp.router(routerConfig: router),
    ),
  );
}

void main() {
  testWidgets('BackTitleHeader clears the status bar and pops on tap', (tester) async {
    await tester.pumpWidget(
      _pushedApp(
        const BackTitleHeader(title: 'Start', italicTitle: 'Role play'),
        padding: const EdgeInsets.only(top: 62),
      ),
    );
    await tester.pumpAndSettle();

    // Regression: Start Role-play drew its title over the clock.
    expect(tester.getTopLeft(find.textContaining('Start')).dy, greaterThanOrEqualTo(62));

    await tester.tap(find.byKey(const Key('back-title-header-back')));
    await tester.pumpAndSettle();
    expect(find.text('root-screen'), findsOneWidget);
  });

  testWidgets('TabScreenHeader on a pushed screen implies a back arrow that pops', (tester) async {
    await tester.pumpWidget(_pushedApp(const TabScreenHeader(title: 'Course')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('tab-screen-header-back')));
    await tester.pumpAndSettle();
    expect(find.text('root-screen'), findsOneWidget);
  });

  testWidgets('TabScreenHeader on a root screen has no back arrow', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: Scaffold(body: TabScreenHeader(title: 'Ally')))),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tab-screen-header-back')), findsNothing);
  });

  testWidgets('TabScreenHeader subtitle inherits the 18pt title size, as RN nests it', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: Scaffold(body: TabScreenHeader(title: 'Ally', subtitle: 'Learn', italicSubtitle: true))),
      ),
    );
    final rich = tester.widget<RichText>(find.descendant(of: find.byType(TabScreenHeader), matching: find.byType(RichText)).first);
    // Text.rich wraps the header's span in one carrying DefaultTextStyle.
    final root = (rich.text as TextSpan).children!.single as TextSpan;
    expect(root.text, 'Ally');
    final subtitle = root.children!.single as TextSpan;
    expect(subtitle.text, ' Learn');
    expect(subtitle.style?.fontSize, isNull, reason: 'must inherit, not override');
    expect(root.style?.fontSize, 18);
  });
}
