import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/providers/cache_for.dart';

void main() {
  testWidgets('keeps an unlistened autoDispose value for the window, then disposes it', (tester) async {
    var builds = 0;
    var disposals = 0;
    final provider = Provider.autoDispose.family<int, int>((ref, id) {
      cacheFor(ref);
      ref.onDispose(() => disposals++);
      return ++builds;
    });
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final sub = container.listen(provider(1), (_, _) {});
    expect(sub.read(), 1);
    sub.close();

    // Re-listened within the window: same cached value, no rebuild.
    await tester.pump(const Duration(seconds: 30));
    final again = container.listen(provider(1), (_, _) {});
    expect(again.read(), 1);
    again.close();
    // The window restarts from the last listener leaving.
    await tester.pump(const Duration(seconds: 59));
    expect(disposals, 0);

    await tester.pump(const Duration(seconds: 2));
    expect(disposals, 1);
    expect(container.read(provider(1)), 2);
    // Drain the timer the fresh read's own cancel started.
    container.dispose();
  });
}
