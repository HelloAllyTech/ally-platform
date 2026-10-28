import 'package:flutter/material.dart';
// `Override` isn't re-exported from the main `flutter_riverpod.dart` barrel
// in this version — only from `misc.dart` (see `pump_app.dart`'s own
// comment on this).
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
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
  userPermissionsProvider.overrideWith((ref) async => const <String>[]),
  currentUserProvider.overrideWith((ref) async => _user(7)),
];

// Own file: pump_app.dart's second-pump-per-file localization stall.
void main() {
  testWidgets('tenant summary-fields hide sections and fields that are not listed (RN visibleFields)', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer(
      (_) async => CallSummaryDetails(counselorId: 7, fields: {'callId': 1001, 'age': '25-34', 'gender': 'Male'}),
    );
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => const <ChatMessage>[]);

    await pumpApp(
      tester,
      CallSummaryScreen(log: _log),
      overrides: [
        callLogRepositoryProvider.overrideWithValue(repository),
        ..._editorOverrides(visibleFields: ['age']),
      ],
    );

    expect(find.text('Features & Demographics'), findsOneWidget);
    expect(find.byKey(const ValueKey('section-header-sessionSummary')), findsNothing);
    expect(find.byKey(const ValueKey('section-header-additionalNotes')), findsOneWidget);

    await tester.tap(find.text('Features & Demographics'));
    await tester.pumpAndSettle();
    expect(find.text('Age'), findsOneWidget);
    expect(find.text('Gender'), findsNothing);
  });
}
