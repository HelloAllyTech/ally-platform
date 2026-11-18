import 'package:ally_mobile_flutter/features/roleplay/presentation/checklist_panel.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../../support/pump_app.dart';

void main() {
  final items = [
    ChecklistItem(id: 'a', name: 'Greet the client', rank: 1, message: 'Say hello warmly.'),
    ChecklistItem(id: 'b', name: 'Ask open questions', rank: 2),
  ];

  Future<void> pump(WidgetTester tester, ChecklistMode mode, Set<String> triggered) {
    return pumpApp(
      tester,
      Scaffold(body: ChecklistPanel(mode: mode, items: items, triggeredEventIds: triggered)),
    );
  }

  testWidgets('OFF mode renders nothing', (tester) async {
    await pump(tester, ChecklistMode.off, {});

    expect(find.byKey(const ValueKey('checklist-panel')), findsNothing);
  });

  testWidgets('GUIDED mode shows item names, progress count, and a status circle per item', (
    tester,
  ) async {
    await pump(tester, ChecklistMode.guided, {'a'});

    expect(find.text('Session Checklist'), findsOneWidget);
    expect(find.textContaining('Progress'), findsOneWidget);
    expect(find.textContaining('1 of 2'), findsOneWidget);
    expect(find.text('Greet the client'), findsOneWidget);
    expect(find.text('Ask open questions'), findsOneWidget);
    expect(find.byKey(const ValueKey('checklist-status-a')), findsOneWidget);
  });

  testWidgets('UNGUIDED mode shows rank until triggered, then reveals the name', (tester) async {
    await pump(tester, ChecklistMode.unguided, {});

    expect(find.text('1'), findsOneWidget);
    expect(find.text('Greet the client'), findsNothing);

    await pump(tester, ChecklistMode.unguided, {'a'});

    expect(find.text('Greet the client'), findsOneWidget);
  });

  testWidgets('tapping a GUIDED item with a message expands its description', (tester) async {
    await pump(tester, ChecklistMode.guided, {});

    expect(find.text('Say hello warmly.'), findsNothing);

    await tester.tap(find.text('Greet the client'));
    await tester.pump();

    expect(find.text('Say hello warmly.'), findsOneWidget);
  });

  testWidgets('LIST mode hides the status circle and progress line', (tester) async {
    await pump(tester, ChecklistMode.list, {'a'});

    expect(find.byKey(const ValueKey('checklist-status-a')), findsNothing);
    expect(find.textContaining('Progress'), findsNothing);
  });
}
