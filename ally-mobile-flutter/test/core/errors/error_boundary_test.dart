import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/errors/error_boundary.dart';

import '../../support/fake_translations.dart';

class _Thrower extends StatelessWidget {
  const _Thrower();

  @override
  Widget build(BuildContext context) => throw StateError('boom');
}

void main() {
  tearDown(() => renderErrorNotifier.value = null);

  Future<void> pumpBoundary(WidgetTester tester, {required Widget home, required VoidCallback onReset}) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [fixedTranslationsOverride()],
        child: MaterialApp(
          builder: (context, child) => AppErrorBoundary(onReset: onReset, child: child!),
          home: home,
        ),
      ),
    );
  }

  testWidgets('a widget that throws while building swaps the app for RN ErrorFallback', (tester) async {
    final previousBuilder = ErrorWidget.builder;
    ErrorWidget.builder = renderErrorWidgetBuilder;

    var resets = 0;
    await pumpBoundary(tester, home: const _Thrower(), onReset: () => resets++);
    expect(tester.takeException(), isStateError);
    await tester.pump();
    await tester.pump();

    expect(find.text('Something went wrong!'), findsOneWidget);
    expect(find.text('The app ran into an unexpected problem. Your saved work is safe.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    // "Try again" resets (RN re-mounts the navigator) and clears the error.
    await tester.tap(find.byKey(const ValueKey('error-boundary-retry')));
    expect(resets, 1);
    expect(renderErrorNotifier.value, isNull);

    // The binding checks this before tearDown runs.
    ErrorWidget.builder = previousBuilder;
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('shows the app itself while there is no error', (tester) async {
    await pumpBoundary(tester, home: const Text('Home'), onReset: () {});
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Something went wrong!'), findsNothing);
  });
}
