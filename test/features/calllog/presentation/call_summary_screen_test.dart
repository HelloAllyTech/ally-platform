import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_summary_screen.dart';

import '../../../support/pump_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

final _log = CallLogItem(
  id: 1001,
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T10:10:00Z',
  status: 'generated',
  sessionName: 'Walk-in #1',
  score: 88,
);

void main() {
  testWidgets(
    'CallSummaryScreen: renders sections, tracks dirty fields, and saves only changes',
    (tester) async {
      // --- Scenario 1: editing a plain text field marks it dirty, Save ---
      // --- sends only that one changed key, and a read-only field renders ---
      // --- as plain text (not an editable control).                      ---
      final repository = MockCallLogRepository();
      final summary = CallSummaryDetails(
        counselorId: 7,
        fields: {'callId': 1001, 'age': '25-34', 'sessionSummary': 'Initial summary text'},
      );
      when(() => repository.getCallSummary(1001)).thenAnswer((_) async => summary);
      when(() => repository.getChatMessages(1001)).thenAnswer(
        (_) async => [
          ChatMessage(messageId: 1, content: 'Hi', createdAt: '2026-01-01T10:00:00Z', senderId: 7),
        ],
      );
      when(() => repository.updateCallSummary(1001, {'sessionSummary': 'Edited summary text'}))
          .thenAnswer((_) async => summary);

      await pumpApp(
        tester,
        CallSummaryScreen(log: _log),
        overrides: [callLogRepositoryProvider.overrideWithValue(repository)],
      );

      expect(find.text('Summary'), findsOneWidget);
      expect(find.text('Transcript'), findsOneWidget);

      // Save starts disabled — nothing has been edited yet.
      var saveButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'No changes'));
      expect(saveButton.isDisabled, isTrue);

      // Expand "Features & Demographics" — it's the first section, so it's
      // already materialized (the ListView is a Sliver: only materializes
      // other sections once scrolled near them).
      await tester.tap(find.text('Features & Demographics'));
      await tester.pumpAndSettle();

      // Read-only field: shows its value as plain text, not an editable
      // control (no TextFormField/DropdownButtonFormField keyed to it).
      expect(find.text('Call ID'), findsOneWidget);
      expect(find.text('1001'), findsOneWidget);
      expect(find.byKey(const ValueKey('callId')), findsNothing);

      // Dropdown field: renders as a dropdown, pre-selected with its
      // current value, and opens to show its full option list.
      final ageDropdown = find.ancestor(
        of: find.text('Age'),
        matching: find.byType(DropdownButtonFormField<String>),
      );
      expect(ageDropdown, findsOneWidget);
      expect(find.text('25-34'), findsOneWidget, reason: 'current value shown when closed');

      final summaryListForAge = find.byType(ListView).first;
      await tester.drag(summaryListForAge, const Offset(0, -150));
      await tester.pumpAndSettle();
      await tester.tap(ageDropdown);
      await tester.pumpAndSettle();
      expect(find.text('0-5'), findsOneWidget);
      expect(find.text('65+'), findsOneWidget);
      // Dismiss the menu by tapping the modal barrier (not an option) — any
      // option tap, even re-selecting the current value, fires onChanged
      // and would mark "age" dirty too, which would break this scenario's
      // "only sessionSummary was touched" assertion below.
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      // "Session Summary" is a later section — scroll the list until its
      // (not-yet-materialized) header exists, then expand it.
      final summaryList = find.byType(ListView).first;
      await tester.dragUntilVisible(find.text('Session Summary'), summaryList, const Offset(0, -300));
      // `dragUntilVisible` only guarantees the widget's bounds intersect the
      // viewport, not that it's fully clear of the edge — taller field-label
      // rows above it (now IBMPlexSerif body.medium, not labelMedium) shift
      // exactly where it lands, so a direct tap can miss. `ensureVisible`
      // scrolls it fully into view first.
      await tester.ensureVisible(find.text('Session Summary'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Session Summary'));
      await tester.pumpAndSettle();

      // Editing the (multiline) text field marks it dirty and enables Save.
      await tester.dragUntilVisible(
        find.byKey(const ValueKey('sessionSummary')),
        summaryList,
        const Offset(0, -300),
      );
      await tester.enterText(find.byKey(const ValueKey('sessionSummary')), 'Edited summary text');
      await tester.pumpAndSettle();

      saveButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Save changes'));
      expect(saveButton.isDisabled, isFalse);

      await tester.tap(find.widgetWithText(AppButton, 'Save changes'));
      await tester.pumpAndSettle();

      verify(() => repository.updateCallSummary(1001, {'sessionSummary': 'Edited summary text'})).called(1);
      expect(find.text('Call summary updated successfully'), findsOneWidget);

      // After a successful save, Save goes back to disabled (no more
      // pending changes) until something else is edited.
      saveButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'No changes'));
      expect(saveButton.isDisabled, isTrue);

      // --- Scenario 2: changing a dropdown's value also marks it dirty, ---
      // --- and Save sends only that field, from a fresh mount.          ---
      final repository2 = MockCallLogRepository();
      final summary2 = CallSummaryDetails(
        counselorId: 7,
        fields: {'callId': 1001, 'age': '25-34', 'sessionSummary': 'Initial summary text'},
      );
      when(() => repository2.getCallSummary(1001)).thenAnswer((_) async => summary2);
      when(() => repository2.getChatMessages(1001)).thenAnswer((_) async => []);
      when(() => repository2.updateCallSummary(1001, {'age': '35-44'})).thenAnswer((_) async => summary2);

      await pumpApp(
        tester,
        CallSummaryScreen(log: _log),
        overrides: [callLogRepositoryProvider.overrideWithValue(repository2)],
      );

      await tester.tap(find.text('Features & Demographics'));
      await tester.pumpAndSettle();

      final ageDropdown2 = find.ancestor(
        of: find.text('Age'),
        matching: find.byType(DropdownButtonFormField<String>),
      );
      // The section is already fully materialized (it's the first one), so
      // `dragUntilVisible` sees the widget as "found" without actually
      // scrolling it into the viewport — a plain `drag` is needed to bring
      // it above the fold for a real hit-test.
      await tester.drag(find.byType(ListView).first, const Offset(0, -150));
      await tester.pumpAndSettle();
      await tester.tap(ageDropdown2);
      await tester.pumpAndSettle();
      await tester.tap(find.text('35-44').last);
      await tester.pumpAndSettle();

      // Invoke onPressed directly rather than a pixel-coordinate tap — the
      // just-closed dropdown's menu route can leave a stray overlay/absorber
      // sitting at the same screen position as the Save button for a frame,
      // making a real tap miss it unreliably.
      final saveButton2 = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Save changes'));
      saveButton2.onPressed!();
      await tester.pumpAndSettle();

      verify(() => repository2.updateCallSummary(1001, {'age': '35-44'})).called(1);

      // --- Scenario 3: the Transcript tab renders real messages. ---
      final repository3 = MockCallLogRepository();
      final summary3 = CallSummaryDetails(counselorId: 7, fields: {'callId': 1001});
      when(() => repository3.getCallSummary(1001)).thenAnswer((_) async => summary3);
      when(() => repository3.getChatMessages(1001)).thenAnswer(
        (_) async => [
          ChatMessage(
            messageId: 1,
            content: 'Hello counselor',
            createdAt: '2026-01-01T10:00:00Z',
            senderId: 999,
          ),
          ChatMessage(
            messageId: 2,
            content: 'Hello there',
            createdAt: '2026-01-01T10:00:05Z',
            senderId: 7,
          ),
        ],
      );

      await pumpApp(
        tester,
        CallSummaryScreen(log: _log),
        overrides: [callLogRepositoryProvider.overrideWithValue(repository3)],
      );

      await tester.tap(find.text('Transcript'));
      await tester.pumpAndSettle();

      expect(find.text('Hello counselor'), findsOneWidget);
      expect(find.text('Hello there'), findsOneWidget);
    },
  );
}
