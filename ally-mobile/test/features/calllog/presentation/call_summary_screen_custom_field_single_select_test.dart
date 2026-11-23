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
// call_summary_screen_custom_fields_test.dart) for why: a second test in the
// same file intermittently found the un-resolved `summary.sections.*`
// translation keys instead of real text when run right after a heavier
// first test, a pre-existing harness quirk unrelated to this fix.
void main() {
  testWidgets(
    'custom fields: a SINGLE_SELECT value stored as the option id (not its label) still displays the label',
    (tester) async {
      final repository = MockCallLogRepository();
      final customFieldsRepository = MockCustomFieldsRepository();
      final summary = CallSummaryDetails(counselorId: 7, fields: {'callId': 1001});

      when(() => repository.getCallSummary(1001)).thenAnswer((_) async => summary);
      when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

      when(() => customFieldsRepository.getDefinitions()).thenAnswer(
        (_) async => [
          const CustomFieldDefinition(
            id: 'cf-submission-stage',
            name: 'Submission Stage',
            fieldType: CustomFieldType.singleSelect,
            sectionKey: 'featuresAndDemographics',
            editPermission: CustomFieldEditPermission.both,
            options: [
              CustomFieldOption(id: 'b84d73e5-4cff-4de3-b1f3-11dd7fb93eea', label: 'Pending Review', order: 0),
              CustomFieldOption(id: 'opt-approved', label: 'Approved', order: 1),
            ],
          ),
        ],
      );
      // Stored as the option's id, not its label — the real-world case this
      // guards (e.g. a value written some other way than this screen's own
      // save flow, which always writes labels).
      when(() => customFieldsRepository.getValues(1001)).thenAnswer(
        (_) async => const [
          CustomFieldValue(fieldDefinitionId: 'cf-submission-stage', value: 'b84d73e5-4cff-4de3-b1f3-11dd7fb93eea'),
        ],
      );

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

      expect(find.text('Pending Review'), findsOneWidget);
      expect(find.text('b84d73e5-4cff-4de3-b1f3-11dd7fb93eea'), findsNothing);
    },
  );
}
