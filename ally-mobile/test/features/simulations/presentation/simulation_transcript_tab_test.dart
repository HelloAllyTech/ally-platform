import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/simulation_audio_player_controller.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_transcript_tab.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

class MockSimulationTranscriptRepository extends Mock
    implements SimulationTranscriptRepository {}

class _FakePlayback implements SimulationAudioPlaybackController {
  final position = StreamController<Duration>.broadcast();
  final seeks = <Duration>[];

  @override
  Stream<Duration> get onPositionChanged => position.stream;
  @override
  Stream<Duration> get onDurationChanged => const Stream.empty();
  @override
  Stream<PlayerState> get onPlayerStateChanged => const Stream.empty();
  @override
  Future<void> setSourceUrl(String url) async {}
  @override
  Future<void> resume() async {}
  @override
  Future<void> pause() async {}
  @override
  Future<void> seek(Duration position) async => seeks.add(position);
  @override
  Future<void> setPlaybackRate(double rate) async {}
  @override
  Future<void> dispose() async {}
}

SimulationTranscriptMessage _message({
  required int id,
  required int senderId,
  required double startSeconds,
  String content = 'hello',
}) => SimulationTranscriptMessage.fromJson({
  'id': id,
  'senderId': senderId,
  'startSeconds': startSeconds,
  'content': content,
});

void main() {
  late MockSimulationTranscriptRepository repository;

  setUp(() {
    repository = MockSimulationTranscriptRepository();
    when(() => repository.getRecordingUrl(any())).thenAnswer((_) async => null);
  });

  Future<void> pumpTab(WidgetTester tester) => pumpApp(
    tester,
    const SimulationTranscriptTab(scenarioSessionId: 'session-1'),
    overrides: [
      fixedTranslationsOverride(),
      simulationTranscriptRepositoryProvider.overrideWithValue(repository),
    ],
  );

  testWidgets('renders messages chronologically with a speaker label per message', (
    tester,
  ) async {
    when(
      () => repository.getMessages(scenarioSessionId: 'session-1', offset: 0, languageCode: any(named: 'languageCode')),
    ).thenAnswer(
      (_) async => (
        messages: [
          _message(id: 1, senderId: -1, startSeconds: 0, content: 'Hi there'),
          _message(id: 2, senderId: 42, startSeconds: 5, content: 'Hello!'),
        ],
        count: 2,
      ),
    );

    await pumpTab(tester);

    // Chronological order: the AI line (id 1) renders before the learner's
    // reply (id 2).
    final hiIndex = tester.getTopLeft(find.text('Hi there')).dy;
    final helloIndex = tester.getTopLeft(find.text('Hello!')).dy;
    expect(hiIndex, lessThan(helloIndex));

    // RN SimulationTranscriptItem: `mm:ss ` then the speaker label, which
    // for the AI client is "AI client" (no agent name passed here).
    expect(find.text('00:00 '), findsOneWidget);
    expect(find.text('00:05 '), findsOneWidget);
    expect(find.text('AI client'), findsOneWidget);
    expect(find.text('You'), findsOneWidget);
    expect(find.text('Transcription may not always be fully accurate.'), findsOneWidget);
  });

  testWidgets('shows an empty state when there is no transcript', (tester) async {
    when(
      () => repository.getMessages(scenarioSessionId: 'session-1', offset: 0, languageCode: any(named: 'languageCode')),
    ).thenAnswer((_) async => (messages: <SimulationTranscriptMessage>[], count: 0));

    await pumpTab(tester);

    expect(find.text('No transcript available'), findsOneWidget);
  });

  testWidgets('scrolling near the end triggers _loadMore with the next offset, deduping shared ids', (
    tester,
  ) async {
    final firstPage = [
      for (var i = 1; i <= 10; i++)
        _message(id: i, senderId: 42, startSeconds: i.toDouble(), content: 'Message $i'),
    ];
    // The second page overlaps on id 10 (already shown) and adds 5 new ones.
    final secondPage = [
      _message(id: 10, senderId: 42, startSeconds: 10, content: 'Message 10'),
      for (var i = 11; i <= 15; i++)
        _message(id: i, senderId: 42, startSeconds: i.toDouble(), content: 'Message $i'),
    ];

    when(
      () => repository.getMessages(scenarioSessionId: 'session-1', offset: 0, languageCode: any(named: 'languageCode')),
    ).thenAnswer((_) async => (messages: firstPage, count: 20));
    when(
      () => repository.getMessages(scenarioSessionId: 'session-1', offset: 10, languageCode: any(named: 'languageCode')),
    ).thenAnswer((_) async => (messages: secondPage, count: 20));

    await pumpTab(tester);

    expect(find.text('Message 1'), findsOneWidget);
    expect(find.text('Message 15'), findsNothing);

    // Drag the scrollable to its end to cross the `_onScroll` "near the
    // bottom" threshold and trigger `_loadMore`.
    await tester.drag(find.byType(ListView), const Offset(0, -5000));
    await tester.pumpAndSettle();

    verify(
      () => repository.getMessages(scenarioSessionId: 'session-1', offset: 10, languageCode: any(named: 'languageCode')),
    ).called(1);

    // The dedupe keeps only one copy of the overlapping id-10 message —
    // 10 original + 5 genuinely-new ones, not 16.
    final delegate =
        tester.widget<ListView>(find.byType(ListView)).childrenDelegate
            as SliverChildBuilderDelegate;
    expect(delegate.childCount, 15);

    // And a message unique to the second page is reachable by scrolling
    // further, confirming it was actually appended.
    for (var i = 0; i < 10 && find.text('Message 15').evaluate().isEmpty; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, -300));
      await tester.pumpAndSettle();
    }
    expect(find.text('Message 15'), findsOneWidget);
  });

  testWidgets('without a recording it says so; the language dropdown reloads the turns translated', (tester) async {
    when(
      () => repository.getMessages(
        scenarioSessionId: 'session-1',
        offset: 0,
        languageCode: any(named: 'languageCode'),
      ),
    ).thenAnswer((invocation) async {
      final code = invocation.namedArguments[#languageCode] as String?;
      return (
        messages: [_message(id: 1, senderId: -1, startSeconds: 0, content: code == 'hi' ? 'नमस्ते' : 'Hi there')],
        count: 1,
      );
    });

    await pumpTab(tester);

    expect(find.text('No session recording is available for playback.'), findsOneWidget);
    expect(find.text('English (Original)'), findsOneWidget);
    expect(find.text('Hi there'), findsOneWidget);
    verify(
      () => repository.getMessages(scenarioSessionId: 'session-1', offset: 0, languageCode: 'en'),
    ).called(1);

    await tester.tap(find.byKey(const Key('transcript-language-dropdown')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('हिंदी').last);
    await tester.pumpAndSettle();

    verify(
      () => repository.getMessages(scenarioSessionId: 'session-1', offset: 0, languageCode: 'hi'),
    ).called(1);
    expect(find.text('नमस्ते'), findsOneWidget);
  });

  testWidgets('with a recording: the player shows, playback marks the spoken turn, and tapping a turn seeks', (
    tester,
  ) async {
    when(() => repository.getRecordingUrl('session-1')).thenAnswer((_) async => 'https://cdn.example/rec.mp3');
    when(
      () => repository.getMessages(
        scenarioSessionId: 'session-1',
        offset: 0,
        languageCode: any(named: 'languageCode'),
      ),
    ).thenAnswer(
      (_) async => (
        messages: [
          _message(id: 1, senderId: -1, startSeconds: 0, content: 'Hi there'),
          _message(id: 2, senderId: 42, startSeconds: 5, content: 'Hello!'),
        ],
        count: 2,
      ),
    );
    final playback = _FakePlayback();

    await pumpApp(
      tester,
      SimulationTranscriptTab(scenarioSessionId: 'session-1', playbackController: playback),
      overrides: [
        fixedTranslationsOverride(),
        simulationTranscriptRepositoryProvider.overrideWithValue(repository),
      ],
    );

    expect(find.byKey(const Key('transcript-recording-player')), findsOneWidget);
    expect(find.text('No session recording is available for playback.'), findsNothing);

    Border borderOf(String text) {
      final container = tester.widget<Container>(
        find.ancestor(of: find.text(text), matching: find.byType(Container)).first,
      );
      return (container.decoration! as BoxDecoration).border! as Border;
    }

    playback.position.add(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    expect(borderOf('Hello!').top.width, 1.5);
    expect(borderOf('Hi there').top.width, 0.5);

    await tester.tap(find.text('Hi there'));
    await tester.pump();
    expect(playback.seeks, [Duration.zero]);
  });
}
