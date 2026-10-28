import 'package:flutter/material.dart';
// `Override` isn't re-exported from the main `flutter_riverpod.dart` barrel
// in this version — only from `misc.dart` (see `pump_app.dart`'s own
// comment on this).
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_summary_fields.dart';
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

UserProfile _user(int id) =>
    UserProfile(id: id, email: 'me@example.com', name: 'Me', phone: '', profileImageUrl: null, profileCompleted: true);

/// Every summary below has `counselorId: 7` — RN's `SectionWrapper.tsx`
/// gates a section's whole edit-mode toggle on
/// `sectionConfig.canEdit && (isAdmin || isCounsellorForCall)`, so a test
/// user must be the call's counsellor (or an admin) to ever see the pencil
/// button at all.
/// Every built-in field visible, as for a tenant that shows them all.
final _allSummaryFieldKeys = [for (final f in summaryFieldDefs) f.key];

List<Override> _editorOverrides({List<String>? visibleFields}) => [
  summaryVisibleFieldsProvider.overrideWith((ref) async => visibleFields ?? _allSummaryFieldKeys),
  // VIEW_MESSAGES: RN only shows the Transcript tab with it.
  userPermissionsProvider.overrideWith((ref) async => const <String>[UserPermissions.viewMessages]),
  currentUserProvider.overrideWith((ref) async => _user(7)),
];

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
        overrides: [callLogRepositoryProvider.overrideWithValue(repository), ..._editorOverrides()],
      );

      expect(find.text('Summary'), findsOneWidget);
      expect(find.text('Transcript'), findsOneWidget);

      // Save is absent entirely — nothing has been edited yet. RN's
      // `CallSummaryDetails.tsx` renders `showSaveButton && (...)`, so with
      // no pending changes there's no button at all, not a present-but-
      // disabled one.
      expect(find.byType(AppButton), findsNothing);

      // Expand "Features & Demographics" — it's the first section, so it's
      // already materialized (the ListView is a Sliver: only materializes
      // other sections once scrolled near them).
      await tester.tap(find.text('Features & Demographics'));
      await tester.pumpAndSettle();

      // Not yet editing this section: every field — including the genuinely
      // read-only Call ID — renders as plain text, not an editable control.
      expect(find.text('Call ID'), findsOneWidget);
      expect(find.text('1001'), findsOneWidget);
      expect(find.byKey(const ValueKey('callId')), findsNothing);
      expect(find.text('Age'), findsOneWidget);
      expect(find.text('25-34'), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);

      // Enter edit mode via the section's pencil button.
      await tester.tap(find.byKey(const ValueKey('section-edit-featuresAndDemographics')));
      await tester.pumpAndSettle();

      // Call ID stays plain text even while editing — it's genuinely
      // non-editable, unlike Age below.
      expect(find.byKey(const ValueKey('callId')), findsNothing);
      expect(find.text('1001'), findsOneWidget);

      // Age is now a real dropdown, pre-selected with its current value.
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

      // Close this section without saving (nothing was actually changed) —
      // the accordion is exclusive, so another section can't open while
      // this one is still mid-edit. Invoke onPressed directly rather than a
      // pixel-coordinate tap — the dropdown interaction above scrolled the
      // list, so this button's on-screen position has moved.
      tester.widget<IconButton>(find.byKey(const ValueKey('section-close-featuresAndDemographics'))).onPressed!();
      await tester.pumpAndSettle();

      // "Session Summary" is a later section — scroll the list until its
      // (not-yet-materialized) header exists, then expand it. Using the
      // header's own key rather than its text avoids any ambiguity with the
      // field inside it that shares the same display label once expanded.
      final summaryList = find.byType(ListView).first;
      final sessionSummaryHeader = find.byKey(const ValueKey('section-header-sessionSummary'));
      await tester.dragUntilVisible(sessionSummaryHeader, summaryList, const Offset(0, -300));
      // `dragUntilVisible` only guarantees the widget's bounds intersect the
      // viewport, not that it's fully clear of the edge — taller field-label
      // rows above it (now IBMPlexSerif body.medium, not labelMedium) shift
      // exactly where it lands, so a direct tap can miss. `ensureVisible`
      // scrolls it fully into view first.
      await tester.ensureVisible(sessionSummaryHeader);
      await tester.pumpAndSettle();
      await tester.tap(sessionSummaryHeader);
      await tester.pumpAndSettle();
      // Tapping this header also collapses "Features & Demographics" (the
      // accordion is exclusive), which shrinks a lot of now-hidden content
      // above the current scroll position — the list doesn't auto-reanchor,
      // so the just-tapped header (and everything below it) can end up
      // scrolled out of view, in the opposite direction `dragUntilVisible`
      // below searches. Reset to the top first so that search starts fresh.
      await tester.drag(summaryList, const Offset(0, 5000));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const ValueKey('section-edit-sessionSummary')),
        summaryList,
        const Offset(0, -300),
      );
      await tester.tap(find.byKey(const ValueKey('section-edit-sessionSummary')));
      await tester.pumpAndSettle();

      // Editing the (multiline) text field marks it dirty and enables Save.
      await tester.dragUntilVisible(
        find.byKey(const ValueKey('sessionSummary')),
        summaryList,
        const Offset(0, -300),
      );
      await tester.enterText(find.byKey(const ValueKey('sessionSummary')), 'Edited summary text');
      await tester.pumpAndSettle();

      // Appears, labeled "Save" (RN's `common.save`, not a changing
      // "Save changes"/"No changes" label this screen never actually had).
      expect(find.widgetWithText(AppButton, 'Save'), findsOneWidget);

      await tester.tap(find.widgetWithText(AppButton, 'Save'));
      await tester.pumpAndSettle();

      verify(() => repository.updateCallSummary(1001, {'sessionSummary': 'Edited summary text'})).called(1);
      // RN's global Save shows no success toast (only the feedback popup,
      // which needs EDIT_SUMMARY_FEEDBACK this user lacks).
      expect(find.text('Call summary updated successfully'), findsNothing);

      // After a successful save, Save disappears again (no more pending
      // changes) until something else is edited.
      expect(find.byType(AppButton), findsNothing);

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
        // A distinct key from Scenario 1's instance: without one, this
        // structurally-identical widget tree makes Flutter's element
        // reconciliation treat this `pumpApp` call as an *update* of the
        // same tree rather than a fresh mount, preserving (not resetting)
        // `_SummaryTabState`'s instance state — including which section is
        // expanded/mid-edit — from Scenario 1.
        CallSummaryScreen(key: const ValueKey('scenario-2'), log: _log),
        overrides: [callLogRepositoryProvider.overrideWithValue(repository2), ..._editorOverrides()],
      );

      await tester.tap(find.text('Features & Demographics'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('section-edit-featuresAndDemographics')));
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
      final saveButton2 = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Save'));
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
        CallSummaryScreen(key: const ValueKey('scenario-3'), log: _log),
        // Same override *shape* as Scenarios 1/2 (just a different
        // repository instance) — Riverpod's `ProviderScope` forbids
        // changing the number of overrides across rebuilds of what it
        // treats as the same scope (`pump_app.dart`'s own `ProviderScope`
        // isn't itself given a fresh key per `pumpApp` call, only
        // `CallSummaryScreen` is here), so every call in this test must
        // pass the same override list shape even where a scenario doesn't
        // otherwise need `_editorOverrides()`.
        overrides: [callLogRepositoryProvider.overrideWithValue(repository3), ..._editorOverrides()],
      );

      await tester.tap(find.text('Transcript'));
      await tester.pumpAndSettle();

      expect(find.text('Hello counselor'), findsOneWidget);
      expect(find.text('Hello there'), findsOneWidget);
    },
  );
}
