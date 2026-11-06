import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_summary_fields.dart';
import 'package:ally_mobile_flutter/features/calllog/data/places_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_summary_screen.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_transcript_tab.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/searchable_location_dropdown.dart';

import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

class MockPlacesRepository extends Mock implements PlacesRepository {}

final _log = CallLogItem(
  id: 1001,
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T10:10:00Z',
  status: 'generated',
  sessionName: 'CALL-1001',
  score: null,
);

void main() {
  group('3-dot menu (RN SummaryModals)', () {
    testWidgets('Export is only offered once a summary exists', (tester) async {
      final repository = MockCallLogRepository();
      when(() => repository.getCallSummary(1001)).thenAnswer(
        (_) async => CallSummaryDetails.fromJson({'id': 1001, 'summaryStatus': 'IN_PROGRESS', 'details': {}}),
      );
      when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

      // The generating view animates forever: bounded pumps, no settle.
      SharedPreferences.setMockInitialValues({});
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            fixedTranslationsOverride(),
            callLogRepositoryProvider.overrideWithValue(repository),
            userPermissionsProvider.overrideWith((ref) async => const <String>[]),
          ],
          child: MaterialApp(home: CallSummaryScreen(log: _log)),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      await tester.tap(find.byKey(const Key('call-summary-menu')));
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.byKey(const Key('call-summary-menu-rename')), findsOneWidget);
      expect(find.byKey(const Key('call-summary-menu-export')), findsNothing);
      expect(find.byKey(const Key('call-summary-menu-data-policy')), findsOneWidget);
      expect(find.byKey(const Key('call-summary-menu-archive')), findsOneWidget);
    });
  });

  testWidgets('without VIEW_MESSAGES there is no Transcript tab (RN showTranscriptTab)', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer(
      (_) async => CallSummaryDetails(counselorId: 7, fields: const {'sessionSummary': 'x'}),
    );
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await pumpApp(
      tester,
      CallSummaryScreen(log: _log),
      overrides: [
        fixedTranslationsOverride(),
        callLogRepositoryProvider.overrideWithValue(repository),
        userPermissionsProvider.overrideWith((ref) async => const <String>[]),
        summaryVisibleFieldsProvider.overrideWith((ref) async => [for (final f in summaryFieldDefs) f.key]),
        currentUserProvider.overrideWith(
          (ref) async =>
              UserProfile(id: 7, email: 'a@b.c', name: 'Me', phone: '', profileImageUrl: null, profileCompleted: true),
        ),
      ],
    );

    expect(find.text('Summary'), findsOneWidget);
    expect(find.text('Transcript'), findsNothing);
  });

  group('CallTranscriptTab (RN CallTranscript)', () {
    testWidgets('shows mm:ss from startSeconds and You/Client labels', (tester) async {
      await pumpApp(
        tester,
        Scaffold(
          body: CallTranscriptTab(
            summary: CallSummaryDetails(counselorId: 7, fields: const {}),
            messagesAsync: AsyncData([
              ChatMessage(messageId: 1, content: 'Hello', createdAt: '', senderId: 7, startSeconds: 65.4),
              ChatMessage(messageId: 2, content: 'Hi', createdAt: '', senderId: 9, startSeconds: 70),
            ]),
          ),
        ),
        overrides: [fixedTranslationsOverride()],
      );

      expect(find.text('01:05 '), findsOneWidget);
      expect(find.text('01:10 '), findsOneWidget);
      expect(find.text('You'), findsOneWidget);
      expect(find.text('Client'), findsOneWidget);
    });

    testWidgets('a DICTATION note merges every turn into one block', (tester) async {
      await pumpApp(
        tester,
        Scaffold(
          body: CallTranscriptTab(
            summary: CallSummaryDetails.fromJson({
              'id': 1,
              'details': {
                'callInfo': {'mode': 'DICTATION'},
              },
            }),
            messagesAsync: AsyncData([
              ChatMessage(messageId: 1, content: 'First', createdAt: '', senderId: 7),
              ChatMessage(messageId: 2, content: 'second', createdAt: '', senderId: 7),
            ]),
          ),
        ),
      );

      expect(find.byKey(const Key('dictation-transcript')), findsOneWidget);
      expect(find.text('First second'), findsOneWidget);
    });

    test('WEBRTC times count from the chat createdAt', () {
      final summary = CallSummaryDetails.fromJson({
        'id': 1,
        'createdAt': '2026-01-01T10:00:00Z',
        'details': {
          'callInfo': {'provider': 'WEBRTC'},
        },
      });
      final message = ChatMessage(messageId: 1, content: 'x', createdAt: '2026-01-01T10:02:03Z', senderId: 1);

      expect(transcriptTimeFor(message, summary), '02:03');
    });
  });

  group('SearchableLocationDropdown (RN SearchableLocationDropdown)', () {
    testWidgets('lists /places, searches after typing, and stores "City, State"', (tester) async {
      final places = MockPlacesRepository();
      when(() => places.getPlaces(page: 1)).thenAnswer(
        (_) async => (places: const [Place(id: 1, city: 'Pune', state: 'Maharashtra')], total: 1),
      );
      when(() => places.searchPlaces('Ben')).thenAnswer(
        (_) async => const [Place(id: 2, city: 'Bengaluru', state: 'Karnataka')],
      );
      String? selected;

      await pumpApp(
        tester,
        Scaffold(
          body: Center(
            child: SizedBox(
              width: 200,
              child: SearchableLocationDropdown(value: '', onSelect: (v) => selected = v),
            ),
          ),
        ),
        overrides: [fixedTranslationsOverride(), placesRepositoryProvider.overrideWithValue(places)],
      );

      expect(find.text('Select location'), findsOneWidget);
      await tester.tap(find.byType(SearchableLocationDropdown));
      await tester.pumpAndSettle();
      expect(find.text('Pune, Maharashtra'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('location-search-input')), 'Ben');
      await tester.pump(const Duration(milliseconds: 299));
      verifyNever(() => places.searchPlaces(any()));
      await tester.pump(const Duration(milliseconds: 2));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Bengaluru, Karnataka'));
      await tester.pumpAndSettle();

      expect(selected, 'Bengaluru, Karnataka');
    });

    testWidgets('a search with no matches says so', (tester) async {
      final places = MockPlacesRepository();
      when(() => places.getPlaces(page: 1)).thenAnswer((_) async => (places: const <Place>[], total: 0));
      when(() => places.searchPlaces('zz')).thenAnswer((_) async => const <Place>[]);

      await pumpApp(
        tester,
        Scaffold(
          body: SearchableLocationDropdown(value: 'Pune, Maharashtra', onSelect: (_) {}),
        ),
        overrides: [fixedTranslationsOverride(), placesRepositoryProvider.overrideWithValue(places)],
      );

      await tester.tap(find.byType(SearchableLocationDropdown));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('location-search-input')), 'zz');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();

      expect(find.text('No locations found'), findsOneWidget);
    });
  });

  test('Location is a searchable dropdown field (RN FieldType.SearchableDropdown)', () {
    expect(summaryFieldDefs.firstWhere((f) => f.key == 'location').type, SummaryFieldType.searchableDropdown);
  });

  test('VIEW_MESSAGES permission constant matches RN', () {
    expect(UserPermissions.viewMessages, 'view:messages');
  });
}
