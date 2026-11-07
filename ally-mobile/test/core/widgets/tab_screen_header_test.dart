import 'package:ally_mobile_flutter/core/navigation/drawer_menu_button.dart';
import 'package:ally_mobile_flutter/core/widgets/tab_screen_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// `TabScreenHeader` renders `ProgressHeaderWidget` itself now (RN's
// always-on level indicator) — a `ConsumerWidget` that needs a
// `ProviderScope` ancestor even when, as here, every provider it reads is
// left unmocked and simply resolves to "don't show anything yet".
void _noop() {}

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

  testWidgets('a wide trailing control is capped instead of overflowing the row', (tester) async {
    // Leaderboard's icon + "7 Badges" button once overflowed this row. The
    // trailing slot is width-capped rather than Flexible: a Flexible split
    // the free width with the title and pushed it away from the menu.
    await tester.pumpWidget(
      _wrap(
        const TabScreenHeader(
          title: 'Community',
          trailing: SizedBox(key: Key('trailing'), width: 2000, height: 10),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    final width = tester.view.physicalSize.width / tester.view.devicePixelRatio;
    expect(tester.getSize(find.byKey(const Key('trailing'))).width, lessThanOrEqualTo(width * 0.45));
  });

  testWidgets('the title starts right after the leading control', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const TabScreenHeader(
          title: 'Ally',
          leading: SizedBox(key: Key('leading'), width: 24, height: 20),
          trailing: Text('23/120'),
        ),
      ),
    );

    final leadingRight = tester.getRect(find.byKey(const Key('leading'))).right;
    expect(tester.getRect(find.textContaining('Ally')).left, leadingRight + 6);
  });

  testWidgets('omits the bottom border when showBorder is false', (tester) async {
    await tester.pumpWidget(
      _wrap(const TabScreenHeader(title: 'Ally', showBorder: false)),
    );

    final container = tester.widget<Container>(find.byType(Container).first);
    expect(container.decoration, isNull);
  });

  group('drawer menu button', () {
    testWidgets('is absent outside the shell (no DrawerMenuScope)', (tester) async {
      await tester.pumpWidget(_wrap(const TabScreenHeader(title: 'Ally', subtitle: 'Learn')));

      expect(find.byType(DrawerMenuButton), findsNothing);
    });

    testWidgets('is absent on a tab that is not the first one', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const DrawerMenuScope(
            onOpenDrawer: null,
            child: TabScreenHeader(title: 'Ally', subtitle: 'Learn'),
          ),
        ),
      );

      expect(find.byType(DrawerMenuButton), findsNothing);
    });

    testWidgets('sits left of the title on the first tab instead of on top of it', (tester) async {
      // Regression: the shell used to paint this button in a Positioned
      // layer over the tab, right across the "Ally Learn" title.
      await tester.pumpWidget(
        _wrap(
          const DrawerMenuScope(
            onOpenDrawer: _noop,
            child: TabScreenHeader(title: 'Ally', subtitle: 'Learn'),
          ),
        ),
      );

      final button = tester.getRect(find.byType(DrawerMenuButton));
      final title = tester.getRect(find.textContaining('Ally'));
      expect(button.right, lessThanOrEqualTo(title.left));
    });

    testWidgets("yields to the caller's own leading control", (tester) async {
      await tester.pumpWidget(
        _wrap(
          const DrawerMenuScope(
            onOpenDrawer: _noop,
            child: TabScreenHeader(
              title: 'Archives',
              leading: Icon(Icons.arrow_back, key: Key('leading')),
            ),
          ),
        ),
      );

      expect(find.byKey(const Key('leading')), findsOneWidget);
      expect(find.byType(DrawerMenuButton), findsNothing);
    });

    testWidgets("opens the shell's drawer, past the tab screen's own Scaffold", (tester) async {
      // Regression: every tab screen has its own drawer-less Scaffold, so a
      // `Scaffold.of` lookup from the button found that one and did nothing.
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: Scaffold(
              drawer: const Drawer(child: Text('drawer-contents')),
              body: Builder(
                builder: (shellContext) => DrawerMenuScope(
                  onOpenDrawer: Scaffold.of(shellContext).openDrawer,
                  child: const Scaffold(
                    body: TabScreenHeader(title: 'Ally', subtitle: 'Learn'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.byType(DrawerMenuButton));
      await tester.pumpAndSettle();

      expect(find.text('drawer-contents'), findsOneWidget);
    });
  });
}
