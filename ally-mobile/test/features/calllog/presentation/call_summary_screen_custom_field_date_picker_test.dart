import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_summary_fields.dart';
import 'package:ally_mobile_flutter/features/calllog/data/custom_fields_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_summary_screen.dart';

import '../../../support/pump_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

class MockCustomFieldsRepository extends Mock implements CustomFieldsRepository {}

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

// One `testWidgets` per file — see
// scribe_recording_screen_initial_state_test.dart (and this file's sibling
// call_summary_screen_custom_fields_test.dart) for why.
void main() {
  testWidgets(
    'custom fields: a DATE value opens a native date picker instead of a text box, '
    'and shows the picked date as DD-MM-YYYY',
    (tester) async {
      final repository = MockCallLogRepository();
      final customFieldsRepository = MockCustomFieldsRepository();
      final summary = CallSummaryDetails(counselorId: 7, fields: {'callId': 1001});

      when(() => repository.getCallSummary(1001)).thenAnswer((_) async => summary);
      when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

      when(() => customFieldsRepository.getDefinitions()).thenAnswer(
        (_) async => [
          const CustomFieldDefinition(
            id: 'cf-session-date',
            name: 'Session Date (Manual)',
            fieldType: CustomFieldType.date,
            sectionKey: 'featuresAndDemographics',
            editPermission: CustomFieldEditPermission.both,
          ),
        ],
      );
      when(() => customFieldsRepository.getValues(1001)).thenAnswer(
        (_) async => const [CustomFieldValue(fieldDefinitionId: 'cf-session-date', value: '2026-02-03')],
      );
      when(() => customFieldsRepository.upsertValues(1001, any())).thenAnswer((_) async {});

      await pumpApp(
        tester,
        CallSummaryScreen(log: _log),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          customFieldsRepositoryProvider.overrideWithValue(customFieldsRepository),
          customFieldsEnabledProvider.overrideWith((ref) async => true),
          summaryVisibleFieldsProvider.overrideWith((ref) async => [for (final f in summaryFieldDefs) f.key]),
          userPermissionsProvider.overrideWith((ref) async => const <String>[]),
          currentUserProvider.overrideWith((ref) async => _user(7)),
        ],
      );

      await tester.tap(find.text('Features & Demographics'));
      await tester.pumpAndSettle();

      // DD-MM-YYYY on the read-only row, not the stored YYYY-MM-DD.
      expect(find.text('03-02-2026'), findsOneWidget);
      expect(find.text('2026-02-03'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('section-edit-featuresAndDemographics')));
      await tester.pumpAndSettle();

      // Invoke onTap directly rather than a pixel-coordinate tap — like this
      // file's sibling custom-fields test, entering edit mode can scroll the
      // field out of real hit-test range.
      final dateField = tester.widget<GestureDetector>(find.byKey(const ValueKey('date-field-cf-session-date')));
      dateField.onTap!();
      await tester.pumpAndSettle();

      // The real Material date picker opened (not a text field) — its
      // calendar is seeded on the existing value, so February 2026 is open
      // and day 3 is already selected.
      expect(find.byType(DatePickerDialog), findsOneWidget);

      await tester.tap(find.text('10'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      expect(find.byType(DatePickerDialog), findsNothing);
      expect(find.text('10-02-2026'), findsOneWidget);
    },
  );
}
