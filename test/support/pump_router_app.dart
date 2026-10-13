import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_translations.dart';

/// Widget-test harness for screens that navigate via go_router
/// (`context.push`/`context.go`) — `pumpApp` alone can't exercise those,
/// since it wraps the widget in a plain `MaterialApp` with no `GoRouter`
/// ancestor and `context.push` would throw. Builds a real `GoRouter` with
/// the given routes instead, so navigation resolves for real and a test
/// can assert it landed by rendering the destination route's own widget
/// (usually just a marker `Text`, see call sites).
///
/// Also overrides `localizationControllerProvider` via
/// `fixedTranslationsOverride()` for the same reliability reason `pumpApp`
/// callers are pointed at in `fake_translations.dart`'s doc comment.
Future<GoRouter> pumpRouterApp(
  WidgetTester tester, {
  required String initialLocation,
  required List<GoRoute> routes,
  List<Override> overrides = const [],
}) async {
  SharedPreferences.setMockInitialValues({});
  final router = GoRouter(initialLocation: initialLocation, routes: routes);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [fixedTranslationsOverride(), ...overrides],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}
