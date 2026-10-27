import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/voice_note_section.dart';

import '../../../support/mock_path_provider.dart';
import '../../../support/mock_record_platform.dart';
import '../../../support/pump_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

List<Override> _overrides(
  MockCallLogRepository repository, {
  bool isCounselor = true,
  bool voiceEnabled = true,
}) => [
  userPermissionsProvider.overrideWith((ref) async => isCounselor ? [UserPermissions.counselorAccess] : <String>[]),
  scribeVoiceNoteEnabledProvider.overrideWith((ref) async => voiceEnabled),
  callLogRepositoryProvider.overrideWithValue(repository),
];

void main() {
  setUpAll(() {
    registerFallbackValue(const RecordConfig());
    installFakePathProvider();
  });

  late MockCallLogRepository repository;
  late MockRecordPlatform platform;

  setUp(() {
    repository = MockCallLogRepository();
    platform = installMockRecordPlatform();
    when(() => platform.onStateChanged(any())).thenAnswer((_) => const Stream.empty());
  });

  // One comprehensive `testWidgets` with sequential steps — per
  // `pump_app.dart`'s documented translation stall, a second `testWidgets`
  // calling `pumpApp` in this file would leave `localizationControllerProvider`
  // stuck loading. Also deliberately avoids `pumpAndSettle()` from the point
  // recording starts onward: `VoiceNoteRecorder`'s duration ticker and
  // `_VoiceNotePanel`'s generating-message cycler are both real
  // `Timer.periodic`s, and `pumpAndSettle()` repeatedly advances
  // `flutter_test`'s fake clock looking for a quiet frame — which a
  // perpetually-rearming periodic timer never produces, hanging the test
  // (same class of issue documented in
  // `branching_scenario_player_test.dart`'s exhausted-pause test). Bare
  // zero-duration `pump()` calls never advance the fake clock, so the
  // tickers never fire, while still draining the microtask-resolved mocked
  // Futures.
  //
  // A SECOND, distinct translation-stall trap found while writing this test
  // (not the one `pump_app.dart` documents): `VoiceNoteSection.build()` only
  // calls `ref.t()` — and so only *first touches*
  // `localizationControllerProvider` — once `canUseVoice` is true, which
  // itself depends on two other `FutureProvider`s
  // (`userPermissionsProvider`/`scribeVoiceNoteEnabledProvider`) that are
  // still `AsyncLoading` on the very first build. `pumpApp()`'s own
  // `runAsync(...)` call (the one real-zone window that drains
  // `rootBundle.loadString`) has already happened by the time those two
  // providers resolve and the widget rebuilds into the branch that first
  // touches `localizationControllerProvider` — so that provider's real I/O
  // only *starts* after `pumpApp()` returns, inside `pumpAndSettle()`'s
  // fake-async pumping, which never drains real I/O. The fix is the second
  // `runAsync`+`pumpAndSettle` pair right after `pumpApp()` below — it gives
  // that now-freshly-started load a real-zone window of its own. Any other
  // widget gating its *first* `ref.t()`/`ref.tr()` call behind another async
  // provider will hit this same trap.
  testWidgets('record -> pause/resume -> stop -> generate applies values and saves the transcript', (tester) async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => true);
    when(() => platform.start(any(), any(), path: any(named: 'path'))).thenAnswer((_) async {});
    when(() => platform.pause(any())).thenAnswer((_) async {});
    when(() => platform.resume(any())).thenAnswer((_) async {});
    when(() => platform.stop(any())).thenAnswer((_) async => null);
    when(
      () => repository.generateNoteFromAudio(
        audioFilePath: any(named: 'audioFilePath'),
        fields: any(named: 'fields'),
      ),
    ).thenAnswer(
      (_) async => (
        transcript: 'Client discussed anxiety.',
        values: [(id: 'sessionSummary', value: 'Discussed anxiety')],
      ),
    );
    when(
      () => repository.saveNoteTranscript(chatId: any(named: 'chatId'), transcript: any(named: 'transcript')),
    ).thenAnswer((_) async {});

    Map<String, dynamic>? appliedValues;
    await pumpApp(
      tester,
      Scaffold(
        body: VoiceNoteSection(
          chatId: 42,
          onValuesApplied: (updates) async {
            appliedValues = updates;
          },
        ),
      ),
      overrides: _overrides(repository),
    );
    // See the comment above — drains the localization load that only
    // started once the gating providers resolved.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pumpAndSettle();

    // 1. Idle: the record CTA is offered.
    expect(find.byKey(const Key('voice-note-record-cta')), findsOneWidget);

    // 2. Tap -> opens the panel and starts recording immediately.
    await tester.tap(find.byKey(const Key('voice-note-record-cta')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('voice-note-recording')), findsOneWidget);
    expect(find.byKey(const Key('voice-note-pause')), findsOneWidget);
    verify(() => platform.start(any(), any(), path: any(named: 'path'))).called(1);

    // 3. Pause -> Resume.
    await tester.tap(find.byKey(const Key('voice-note-pause')));
    await tester.pump();
    expect(find.byKey(const Key('voice-note-resume')), findsOneWidget);

    await tester.tap(find.byKey(const Key('voice-note-resume')));
    await tester.pump();
    expect(find.byKey(const Key('voice-note-pause')), findsOneWidget);

    // 4. Stop -> the "ready" panel (discard/generate).
    await tester.tap(find.byKey(const Key('voice-note-stop')));
    await tester.pump();
    expect(find.byKey(const Key('voice-note-ready')), findsOneWidget);
    expect(find.byKey(const Key('voice-note-generate')), findsOneWidget);

    // 5. Generate -> applies the extracted values, saves the transcript, and
    // closes the panel back to the idle CTA.
    await tester.tap(find.byKey(const Key('voice-note-generate')));
    await tester.pump();
    expect(find.byKey(const Key('voice-note-generating')), findsOneWidget);
    await tester.pump();
    await tester.pump();

    expect(appliedValues, {'sessionSummary': 'Discussed anxiety'});
    verify(
      () => repository.saveNoteTranscript(chatId: 42, transcript: 'Client discussed anxiety.'),
    ).called(1);

    // `VoiceNoteRecorder.reset()` (called once generation succeeds) does
    // real `dart:io` file-existence/delete calls on the fake temp path —
    // genuine I/O, same class of real-zone requirement as
    // `rootBundle.loadString` above, which plain `pump()` can't drain inside
    // `testWidgets`'s fake-async zone.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pump();

    expect(find.byKey(const Key('voice-note-record-cta')), findsOneWidget);
  });

  // `pumpApp`'s documented translation stall (see the comment above) rules
  // out a second `pumpApp` call anywhere else in this file — these
  // independent-state scenarios instead use a bare `pumpWidget` (no
  // `pumpApp`, no `runAsync`), matching `bucket_sort_player_test.dart`'s
  // established pattern for the same constraint. Both scenarios below only
  // assert on widget *presence*, not translated copy, so the fallback-to-
  // raw-i18n-key behavior doesn't matter here.
  Future<void> pumpBare(WidgetTester tester, Widget child, List<Override> overrides) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(overrides: overrides, child: MaterialApp(home: Scaffold(body: child))),
    );
  }

  testWidgets('offers nothing when the tenant has not enabled voice notes', (tester) async {
    await pumpBare(
      tester,
      VoiceNoteSection(chatId: 1, onValuesApplied: (_) async {}),
      _overrides(repository, voiceEnabled: false),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('voice-note-record-cta')), findsNothing);
  });

  testWidgets('a mic-permission denial closes the panel and resets to the idle CTA', (tester) async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => false);

    await pumpBare(
      tester,
      VoiceNoteSection(chatId: 2, onValuesApplied: (_) async {}),
      _overrides(repository),
    );
    await tester.pump();
    await tester.pump();

    await tester.tap(find.byKey(const Key('voice-note-record-cta')));
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('voice-note-recording')), findsNothing);
    expect(find.byKey(const Key('voice-note-record-cta')), findsOneWidget);
  });
}
