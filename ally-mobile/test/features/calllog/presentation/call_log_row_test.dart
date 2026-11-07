import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/status_badge.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_log_row.dart';

void main() {
  Future<void> pump(
    WidgetTester tester, {
    bool enabled = true,
    VoidCallback? onTap,
    List<CallTag> tags = const [],
  }) {
    return tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CallLogRow(
            title: 'Walk-in #1',
            status: ChatSummaryStatus.success,
            dateLine: 'Jul 16 • 12:05 PM',
            durationText: 'Duration: 4 mins 37 secs',
            scoreText: 'Session points: 91',
            tags: tags,
            enabled: enabled,
            onTap: onTap ?? () {},
          ),
        ),
      ),
    );
  }

  testWidgets('collapsed by default: shows title/date but not duration, score or tags', (
    tester,
  ) async {
    await pump(
      tester,
      tags: [CallTag(tag: 'Empathetic', positivityRating: 5)],
    );

    expect(find.text('Walk-in #1'), findsOneWidget);
    expect(find.text('Jul 16 • 12:05 PM'), findsOneWidget);
    expect(find.text('Duration: 4 mins 37 secs'), findsNothing);
    expect(find.text('Empathetic'), findsNothing);
  });

  testWidgets('tapping the chevron expands to reveal duration/score and tags, without firing onTap', (
    tester,
  ) async {
    var tapped = false;
    await pump(
      tester,
      onTap: () => tapped = true,
      tags: [CallTag(tag: 'Empathetic', positivityRating: 5)],
    );

    await tester.tap(find.byKey(const ValueKey('call-log-row-toggle')));
    await tester.pump();

    expect(find.textContaining('Duration: 4 mins 37 secs'), findsOneWidget);
    expect(find.textContaining('Session points: 91'), findsOneWidget);
    expect(find.text('Empathetic'), findsOneWidget);
    expect(tapped, isFalse, reason: 'toggling expand is a separate gesture from row tap');

    // Tapping again collapses it back.
    await tester.tap(find.byKey(const ValueKey('call-log-row-toggle')));
    await tester.pump();
    expect(find.textContaining('Duration: 4 mins 37 secs'), findsNothing);
  });

  testWidgets('tapping anywhere else on the row fires onTap', (tester) async {
    var tapped = false;
    await pump(tester, onTap: () => tapped = true);

    await tester.tap(find.text('Walk-in #1'));
    await tester.pump();

    expect(tapped, isTrue);
  });

  testWidgets('disabled hides the eye icon and never fires onTap, but the chevron still works', (
    tester,
  ) async {
    var tapped = false;
    await pump(tester, enabled: false, onTap: () => tapped = true);

    expect(find.byKey(const ValueKey('call-log-row-eye')), findsNothing);
    await tester.tap(find.text('Walk-in #1'));
    await tester.pump();
    expect(tapped, isFalse);

    await tester.tap(find.byKey(const ValueKey('call-log-row-toggle')));
    await tester.pump();
    expect(find.textContaining('Duration: 4 mins 37 secs'), findsOneWidget);
  });
}
