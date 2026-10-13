import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// `Override` (the type `ProviderScope.overrides` takes) isn't re-exported
// from the main `flutter_riverpod.dart` barrel in this version — only from
// `misc.dart`.
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Shared widget-test harness. Every widget test that pumps a real screen
/// (rather than a pure-logic unit test) should go through this instead of
/// a bare `tester.pumpWidget`, for two reasons discovered while wiring
/// LoginScreen's own test (see `test/widget_test.dart`'s comment for the
/// full story):
///
/// 1. Any screen calling `ref.t()`/`ref.tr()` depends on
///    `localizationControllerProvider`, whose `build()` reads
///    `SharedPreferences` — unmocked, that throws `MissingPluginException`
///    in the test environment and the provider never resolves, so every
///    translated string falls back to showing its raw key.
/// 2. `rootBundle.loadString` (loading the bundled locale JSON) only
///    resolves through real async I/O that plain `pump()`/`pumpAndSettle()`
///    never drains in a widget test — `tester.runAsync` is required.
///
/// Usage:
/// ```dart
/// await pumpApp(tester, const MyScreen(), overrides: [
///   myRepositoryProvider.overrideWithValue(fakeRepo),
/// ]);
/// ```
Future<void> pumpApp(
  WidgetTester tester,
  Widget child, {
  List<Override> overrides = const [],
}) async {
  SharedPreferences.setMockInitialValues({});

  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(home: child),
    ),
  );

  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
  await tester.pumpAndSettle();
}
