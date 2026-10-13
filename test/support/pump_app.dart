import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// `Override` (the type `ProviderScope.overrides` takes) isn't re-exported
// from the main `flutter_riverpod.dart` barrel in this version — only from
// `misc.dart`.
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
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

/// Same as [pumpApp], but for a screen under test that navigates via
/// go_router (`context.go`/`context.push`) — `MaterialApp(home: ...)` has no
/// `GoRouter` in its tree, so any such call throws "No GoRouter found in
/// context" without this. Pass just the routes the test actually exercises
/// (the real `appRouterProvider` in `core/routing/app_router.dart` also
/// layers in auth-state `redirect` logic, deliberately not replicated here —
/// these are scoped screen tests, not a router integration test).
///
/// Gotcha found empirically, and NOT specific to this helper or to
/// go_router (also reproduces with plain [pumpApp] on a stateless screen):
/// calling this — or [pumpApp] — a *second, separate* time from a new
/// `testWidgets` in the same test file can leave that second call's
/// `localizationControllerProvider` stuck in `AsyncLoading` forever (every
/// translated string then falls back to its raw key). Confirmed via direct
/// instrumentation that it's specifically the second `rootBundle.loadString`
/// await inside `LocalizationController.build()` that never resumes, even
/// though a bare, non-widget `rootBundle.loadString` call across the same
/// two tests resolves instantly both times (the asset bundle's own string
/// cache works fine) — so the stall is somewhere in how that provider's
/// `build()` future is driven the second time a widget tree is pumped in a
/// file, not in asset loading itself. Root cause not yet found. Until it
/// is, drive a screen's several scenarios as sequential steps inside one
/// `testWidgets` rather than as separate ones, for any screen whose
/// assertions depend on translated text resolving.
Future<void> pumpRoutedApp(
  WidgetTester tester, {
  required String initialLocation,
  required List<RouteBase> routes,
  List<Override> overrides = const [],
}) async {
  SharedPreferences.setMockInitialValues({});

  final router = GoRouter(initialLocation: initialLocation, routes: routes);

  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
      child: MaterialApp.router(routerConfig: router),
    ),
  );

  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
  await tester.pumpAndSettle();
}
