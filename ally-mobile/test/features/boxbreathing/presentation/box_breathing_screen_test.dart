import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/chat/current_chat_provider.dart';
import 'package:ally_mobile_flutter/features/boxbreathing/presentation/box_breathing_screen.dart';
import 'package:ally_mobile_flutter/features/boxbreathing/presentation/breath_sound_player.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';

import '../../../support/fake_translations.dart';

class _FakeSound implements BreathSoundPlayer {
  final calls = <String>[];

  @override
  Future<void> playAsset() async => calls.add('playAsset');
  @override
  Future<void> replay() async => calls.add('replay');
  @override
  Future<void> pause() async => calls.add('pause');
  @override
  Future<void> setVolume(double volume) async => calls.add('volume:$volume');
  @override
  Future<void> stop() async => calls.add('stop');
}

class _FakeCallLogRepository extends CallLogRepository {
  _FakeCallLogRepository() : super(Dio());

  final requested = <int>[];

  @override
  Future<CallLogItem> getCallLogItem(int chatId) async {
    requested.add(chatId);
    return CallLogItem(
      id: chatId,
      startedAt: '2026-10-28T10:00:00Z',
      endedAt: '2026-10-28T10:10:00Z',
      status: 'ENDED',
      sessionName: 'CALL-$chatId',
      score: null,
    );
  }
}

class _Harness {
  _Harness(this.sound, this.repo, this.container);
  final _FakeSound sound;
  final _FakeCallLogRepository repo;
  final ProviderContainer container;
  Uri? summaryUri;
}

/// The screen loops its animation forever, so no `pumpAndSettle` here.
Future<_Harness> _pump(WidgetTester tester, {bool skipOverlay = true, String initialLocation = '/box-breathing?chatId=42'}) async {
  SharedPreferences.setMockInitialValues({});
  final sound = _FakeSound();
  final repo = _FakeCallLogRepository();
  final container = ProviderContainer(
    overrides: [
      fixedTranslationsOverride(),
      breathSoundPlayerFactoryProvider.overrideWithValue(() => sound),
      callLogRepositoryProvider.overrideWithValue(repo),
    ],
  );
  addTearDown(container.dispose);
  final harness = _Harness(sound, repo, container);
  final router = GoRouter(
    initialLocation: initialLocation,
    routes: [
      GoRoute(
        path: '/box-breathing',
        builder: (_, state) => BoxBreathingScreen(
          chatId: int.tryParse(state.uri.queryParameters['chatId'] ?? ''),
        ),
      ),
      GoRoute(
        path: '/call-log/:id',
        builder: (_, state) {
          harness.summaryUri = state.uri;
          return Text('summary ${state.pathParameters['id']}');
        },
      ),
      GoRoute(path: '/call-summary', builder: (_, state) => const Text('summary without chat')),
      GoRoute(path: '/home', builder: (_, state) => Text('home shell ${state.uri.queryParameters['tab'] ?? ''}'.trim())),
    ],
  );
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
  if (skipOverlay) {
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
  }
  return harness;
}

void main() {
  testWidgets('shows the call-end overlay, swaps its message at 1s, hands over at 3s', (tester) async {
    final h = await _pump(tester, skipOverlay: false);

    expect(find.text('You gave your best in that session'), findsOneWidget);
    expect(find.text('Return to self'), findsNothing);

    await tester.pump(const Duration(milliseconds: 1000));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 10));
    expect(find.text('Now, take a moment for yourself'), findsOneWidget);
    expect(h.sound.calls, isEmpty, reason: 'sound starts with the animation, not the overlay');

    await tester.pump(const Duration(milliseconds: 1500));
    await tester.pump();
    expect(find.text('Now, take a moment for yourself'), findsNothing);
    expect(find.text('Return to self'), findsOneWidget);
    expect(find.text('View Call Summary'), findsOneWidget);
    expect(find.text('Inhale'), findsOneWidget);
    expect(h.sound.calls, ['playAsset', 'replay']);
  });

  testWidgets('advances inhale -> hold -> exhale -> hold -> inhale every 4s', (tester) async {
    await _pump(tester);
    expect(find.text('Inhale'), findsOneWidget);

    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Hold'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Exhale'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Hold'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Inhale'), findsOneWidget);
  });

  testWidgets('counts 1 to 4 within a phase, resetting on the next one', (tester) async {
    await _pump(tester);
    String timer() => tester.widget<Text>(find.byKey(const ValueKey('breathing-timer'))).data!;
    expect(timer(), '1');

    await tester.pump(const Duration(seconds: 1));
    expect(timer(), '2');
    await tester.pump(const Duration(seconds: 1));
    expect(timer(), '3');
    await tester.pump(const Duration(seconds: 1));
    expect(timer(), '4');
    await tester.pump(const Duration(milliseconds: 1050));
    expect(find.text('Hold'), findsOneWidget);
    expect(timer(), '1');
  });

  testWidgets('pause resets to the first Hold phase like RN; resume restarts at Inhale', (tester) async {
    final h = await _pump(tester);

    await tester.tap(find.byKey(const ValueKey('play-pause-button')));
    await tester.pump();
    expect(find.byKey(const ValueKey('play-icon')), findsOneWidget);
    expect(find.text('Hold'), findsOneWidget);
    expect(h.sound.calls.last, 'pause');

    await tester.pump(const Duration(seconds: 5));
    expect(find.text('Hold'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('play-pause-button')));
    await tester.pump();
    expect(find.byKey(const ValueKey('pause-icon')), findsOneWidget);
    expect(find.text('Inhale'), findsOneWidget);
    expect(h.sound.calls.last, 'replay');
  });

  testWidgets('muting sets volume 0 and stops replaying the sound on Inhale', (tester) async {
    final h = await _pump(tester);
    h.sound.calls.clear();

    await tester.tap(find.byKey(const ValueKey('volume-button')));
    await tester.pump();
    expect(find.byKey(const ValueKey('volume-off-icon')), findsOneWidget);
    expect(h.sound.calls, ['volume:0.0']);

    // A full cycle back to Inhale: no replay while muted.
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    }
    expect(find.text('Inhale'), findsOneWidget);
    expect(h.sound.calls, ['volume:0.0']);

    await tester.tap(find.byKey(const ValueKey('volume-button')));
    await tester.pump();
    expect(h.sound.calls, ['volume:0.0', 'volume:1.0', 'replay']);
  });

  testWidgets('View Call Summary opens the ended chat\'s summary in the live flow', (tester) async {
    final h = await _pump(tester);

    await tester.tap(find.text('View Call Summary'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    // RN navigates with no callId: live-flow semantics, nothing prefetched.
    expect(h.repo.requested, isEmpty);
    expect(find.text('summary 42'), findsOneWidget);
    expect(h.summaryUri?.queryParameters['live'], '1');
    expect(h.sound.calls, contains('pause'));
  });

  testWidgets('View Call Summary with no chat still opens Call Summary (RN B8)', (tester) async {
    await _pump(tester, initialLocation: '/box-breathing');

    await tester.tap(find.text('View Call Summary'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('summary without chat'), findsOneWidget);
  });

  testWidgets('back resets to the home shell (Call Log tab) and clears the current chat', (tester) async {
    final h = await _pump(tester);
    h.container.read(currentChatProvider.notifier).set(
      Chat(chatId: 42, status: 'ENDED', provider: 'x', startedAt: '2026-10-28T10:00:00Z', messages: const []),
    );

    await tester.binding.handlePopRoute();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    // RN resets to the Call Log tab.
    expect(find.text('home shell CallLog'), findsOneWidget);
    expect(h.container.read(currentChatProvider), isNull);
    expect(h.sound.calls, containsAllInOrder(['pause', 'stop']));
  });
}
