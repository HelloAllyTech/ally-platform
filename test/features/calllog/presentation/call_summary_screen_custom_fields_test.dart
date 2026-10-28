import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
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

void main() {
  testWidgets(
    'custom fields: render per section, respect edit permission, and save through upsertValues',
    (tester) async {
      final repository = MockCallLogRepository();
      final customFieldsRepository = MockCustomFieldsRepository();
      final summary = CallSummaryDetails(counselorId: 7, fields: {'callId': 1001});

      when(() => repository.getCallSummary(1001)).thenAnswer((_) async => summary);
      when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

      when(() => customFieldsRepository.getDefinitions()).thenAnswer(
        (_) async => [
          const CustomFieldDefinition(
            id: 'cf-referral',
            name: 'Referral Source',
            fieldType: CustomFieldType.text,
            sectionKey: 'featuresAndDemographics',
            editPermission: CustomFieldEditPermission.both,
          ),
          const CustomFieldDefinition(
            id: 'cf-billing-code',
            name: 'Billing Code',
            fieldType: CustomFieldType.text,
            sectionKey: 'featuresAndDemographics',
            editPermission: CustomFieldEditPermission.adminOnly,
          ),
        ],
      );
      when(() => customFieldsRepository.getValues(1001)).thenAnswer(
        (_) async => const [
          CustomFieldValue(fieldDefinitionId: 'cf-referral', value: 'Phone'),
          CustomFieldValue(fieldDefinitionId: 'cf-billing-code', value: 'BC-42'),
        ],
      );
      when(() => customFieldsRepository.upsertValues(1001, any())).thenAnswer((_) async {});

      await pumpApp(
        tester,
        CallSummaryScreen(log: _log),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          customFieldsRepositoryProvider.overrideWithValue(customFieldsRepository),
          customFieldsEnabledProvider.overrideWith((ref) async => true),
          // The call's own counsellor (counselorId: 7), but not an admin —
          // RN's `SectionWrapper.tsx` gates the section's whole edit-mode
          // toggle on `sectionConfig.canEdit && (isAdmin || isCounsellorForCall)`;
          // a custom field's own BOTH/ADMIN_ONLY/COUNSELLOR_ONLY permission
          // only decides which fields become editable INSIDE an
          // already-unlocked section, it can never unlock edit mode by
          // itself for a user who is neither admin nor the call's
          // counsellor. Needs counsellor-or-admin access to prove the
          // ADMIN_ONLY-vs-BOTH distinction below at all.
          userPermissionsProvider.overrideWith((ref) async => const <String>[]),
          currentUserProvider.overrideWith((ref) async => _user(7)),
        ],
      );

      await tester.tap(find.text('Features & Demographics'));
      await tester.pumpAndSettle();

      // Both custom fields render under their tenant-configured name, in the
      // section their sectionKey maps to.
      expect(find.text('Referral Source'), findsOneWidget);
      expect(find.text('Billing Code'), findsOneWidget);

      // Not yet editing this section: both fields show as plain text,
      // regardless of their own per-field permission.
      expect(find.byKey(const ValueKey('cf-referral')), findsNothing);
      expect(find.byKey(const ValueKey('cf-billing-code')), findsNothing);
      expect(find.text('Phone'), findsOneWidget);
      expect(find.text('BC-42'), findsOneWidget);

      // Enter edit mode via the section's pencil button (counsellor-for-call
      // grants section-level edit access).
      await tester.tap(find.byKey(const ValueKey('section-edit-featuresAndDemographics')));
      await tester.pumpAndSettle();

      // ADMIN_ONLY, current user is the counsellor but not an admin: stays
      // read-only (no TextFormField) even while the section is editing.
      expect(find.byKey(const ValueKey('cf-billing-code')), findsNothing);
      expect(find.text('BC-42'), findsOneWidget);

      // BOTH permission: renders as a real, editable TextFormField seeded
      // with its current value.
      final referralField = find.byKey(const ValueKey('cf-referral'));
      expect(referralField, findsOneWidget);
      expect(tester.widget<TextFormField>(referralField).initialValue, 'Phone');

      await tester.enterText(referralField, 'Walk-in');
      await tester.pumpAndSettle();

      // Custom fields save exclusively through the section's own
      // tick/checkmark — RN's global Save button never touches them
      // (`CallSummaryDetails.tsx`'s `onSubmitButtonPress` is built-in-field
      // `handleSubmit()` only; only `SectionWrapper`'s `onTickPress` also
      // calls `handleCustomFieldSave`).
      expect(find.byType(AppButton), findsNothing, reason: 'no built-in field is dirty');
      // Invoke onPressed directly rather than a pixel-coordinate tap — like
      // this file's sibling test, focusing the text field above scrolled
      // the list to keep it visible, which can carry the tick button
      // off-screen for a real hit-test.
      final tickButton = tester.widget<IconButton>(
        find.byKey(const ValueKey('section-tick-featuresAndDemographics')),
      );
      tickButton.onPressed!();
      await tester.pumpAndSettle();

      // Only the dirty custom field is sent, through upsertValues — not
      // updateCallSummary, which is never called since no built-in field
      // changed.
      verifyNever(() => repository.updateCallSummary(any(), any()));
      final captured = verify(() => customFieldsRepository.upsertValues(1001, captureAny())).captured.single
          as List<({String fieldDefinitionId, String? value})>;
      expect(captured, [(fieldDefinitionId: 'cf-referral', value: 'Walk-in')]);

      // The tick exits edit mode — fields show as plain text again.
      expect(find.byKey(const ValueKey('cf-referral')), findsNothing);
      expect(find.text('Walk-in'), findsOneWidget);
    },
  );

  testWidgets('custom fields: nothing renders when the tenant toggle is off', (tester) async {
    final repository = MockCallLogRepository();
    final customFieldsRepository = MockCustomFieldsRepository();
    final summary = CallSummaryDetails(counselorId: 7, fields: {'callId': 1001});

    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => summary);
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await pumpApp(
      tester,
      CallSummaryScreen(log: _log),
      overrides: [
        callLogRepositoryProvider.overrideWithValue(repository),
        customFieldsRepositoryProvider.overrideWithValue(customFieldsRepository),
        customFieldsEnabledProvider.overrideWith((ref) async => false),
      ],
    );
    await tester.pumpAndSettle();

    // The enabled-toggle gate lives in _SummaryTabState.build itself (not
    // inside a per-section widget), so this holds regardless of which
    // section is expanded — no need to expand one to prove it.
    verifyNever(() => customFieldsRepository.getDefinitions());
    verifyNever(() => customFieldsRepository.getValues(any()));
  });
}
