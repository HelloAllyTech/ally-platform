import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/main.dart';

void main() {
  testWidgets('shows the login screen when unauthenticated', (tester) async {
    // LocalizationController reads SharedPreferences during its build();
    // without a mock, the plugin channel throws MissingPluginException in
    // the test environment and translations never resolve, so every
    // ref.t() call falls back to showing its raw key instead of real text.
    SharedPreferences.setMockInitialValues({});

    await tester.pumpWidget(const ProviderScope(child: AllyApp()));
    // `rootBundle.loadString` (loading the bundled locale JSON) only
    // resolves through real asynchronous I/O, which `pump`/`pumpAndSettle`
    // alone never drain in a widget test — `runAsync` is required to let
    // it actually complete, same as any other real I/O a provider awaits.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pumpAndSettle();

    // "Ally" is the app's wordmark, nested inside the "Welcome to Ally"
    // line (its own YesevaOne-Regular style) rather than its own standalone
    // Text widget — see login_screen_test.dart for the fuller greeting check.
    expect(find.text('Welcome to Ally'), findsOneWidget);
    expect(find.text('Next'), findsOneWidget);
  });
}
