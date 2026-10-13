import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';

/// Works around a real flakiness hazard with [pumpApp] (see its own doc
/// comment): `AssetBundle.loadString` routes any asset over 50KB (our
/// `assets/locales/en.json` is ~78KB) through `compute()` — a genuine
/// background isolate round-trip, not a plain Future. On the *second* (and
/// later) widget test within the same test file, resuming that isolate's
/// result back into the fake-async test zone and then synchronously
/// `jsonDecode`-ing it (exactly what `LocalizationController` does) can
/// leave the provider stuck in `AsyncLoading` forever — confirmed by
/// bisection, not just a slow/flaky timing issue (longer waits don't help).
///
/// Pre-fetching the same asset here, fully inside its own `runAsync` call
/// *before* `pumpWidget`, populates `rootBundle`'s internal cache (it
/// memoizes the whole `Future<String>`, not just the resolved value) so the
/// provider's own `await rootBundle.loadString(...)` resolves against an
/// already-completed Future instead of initiating a fresh real/fake zone
/// crossing itself. Call this immediately before every [pumpApp] in a test
/// file that pumps more than one translated screen.
Future<void> preWarmTranslations(WidgetTester tester) {
  return tester.runAsync(() => rootBundle.loadString('assets/locales/en.json'));
}
