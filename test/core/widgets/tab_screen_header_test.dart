import 'package:ally_mobile_flutter/core/widgets/tab_screen_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// `TabScreenHeader` renders `ProgressHeaderWidget` itself now (RN's
// always-on level indicator) — a `ConsumerWidget` that needs a
// `ProviderScope` ancestor even when, as here, every provider it reads is
// left unmocked and simply resolves to "don't show anything yet".
Widget _wrap(Widget child) =>
    ProviderScope(child: MaterialApp(home: Scaffold(body: child)));

void main() {
  testWidgets('renders the title and subtitle together as one text block', (tester) async {
    await tester.pumpWidget(
      _wrap(const TabScreenHeader(title: 'Ally', subtitle: 'Learn')),
    );

    // Subtitle is a nested TextSpan inside the same Text.rich as the title
    // (matching RN's nested-<Text> pattern), not a separate Text widget.
    expect(find.textContaining('Ally'), findsOneWidget);
    expect(find.textContaining('Learn'), findsOneWidget);
  });

  testWidgets('renders trailing content on the right', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const TabScreenHeader(
          title: 'Session Metrics',
          trailing: Icon(Icons.badge, key: Key('trailing')),
        ),
      ),
    );

    expect(find.byKey(const Key('trailing')), findsOneWidget);
  });

  testWidgets('renders leading content on the left', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const TabScreenHeader(
          title: 'Archives',
          leading: Icon(Icons.arrow_back, key: Key('leading')),
        ),
      ),
    );

    expect(find.byKey(const Key('leading')), findsOneWidget);
  });

  testWidgets('trailing is wrapped in Flexible, so it can shrink instead of overflowing the row', (
    tester,
  ) async {
    // Regression test for a real RenderFlex overflow, found via a direct
    // screenshot render with the app's real fonts loaded (not reproducible
    // in an ordinary widget test, which uses a fallback test font whose
    // glyphs measure narrower and hid the bug entirely — confirmed by
    // trying; loading real fonts inside a single test to force it proved
    // too fragile, hanging instead of failing cleanly). `trailing` had no
    // flex/shrink behavior at all, so a title long enough to need its own
    // space plus a wide trailing control (e.g. LeaderboardScreen's icon +
    // "7 Badges" button) could together demand more width than the row
    // actually had. Asserting the fix's actual mechanism — a `Flexible`
    // ancestor — is deterministic regardless of font metrics, unlike
    // reproducing the overflow pixel-for-pixel.
    await tester.pumpWidget(
      _wrap(
        const TabScreenHeader(
          title: 'Community',
          trailing: Icon(Icons.badge, key: Key('trailing')),
        ),
      ),
    );

    expect(
      find.ancestor(of: find.byKey(const Key('trailing')), matching: find.byType(Flexible)),
      findsOneWidget,
    );
  });

  testWidgets('omits the bottom border when showBorder is false', (tester) async {
    await tester.pumpWidget(
      _wrap(const TabScreenHeader(title: 'Ally', showBorder: false)),
    );

    final container = tester.widget<Container>(find.byType(Container).first);
    expect(container.decoration, isNull);
  });
}
