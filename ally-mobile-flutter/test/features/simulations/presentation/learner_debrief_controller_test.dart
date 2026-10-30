import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/learner_debrief_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/widgets/feedback/learner_debrief_controller.dart';

import '../data/learner_debrief_repository_test.dart' show readyDebriefJson;

class MockLearnerDebriefRepository extends Mock implements LearnerDebriefRepository {}

LearnerDebriefView _view(String state) => LearnerDebriefView.fromJson({'state': state});

void main() {
  late MockLearnerDebriefRepository repo;

  setUpAll(() => registerFallbackValue(DebriefFlagReason.didntSay));
  setUp(() => repo = MockLearnerDebriefRepository());

  LearnerDebriefController make() => LearnerDebriefController(repository: repo, sessionId: 's-1');

  test('not_available keeps today\'s debrief (view is null)', () async {
    when(() => repo.getDebrief('s-1')).thenAnswer((_) async => _view('not_available'));
    final c = make();
    await c.load();
    expect(c.view, isNull);
    c.dispose();
  });

  test('a failed first request keeps today\'s debrief', () async {
    when(() => repo.getDebrief('s-1')).thenThrow(Exception('500'));
    final c = make();
    await c.load();
    expect(c.view, isNull);
    c.dispose();
  });

  test('a blank session id never asks', () async {
    final c = LearnerDebriefController(repository: repo, sessionId: '');
    await c.load();
    verifyNever(() => repo.getDebrief(any()));
    c.dispose();
  });

  // testWidgets for its fake clock: `pump(duration)` advances the poll timer.
  testWidgets('polls every 5 s only while working, and a failed poll keeps the last answer', (tester) async {
    final answers = <Object>[
      _view('working'),
      Exception('blip'),
      _view('working'),
      LearnerDebriefView.fromJson(readyDebriefJson()),
    ];
    var calls = 0;
    when(() => repo.getDebrief('s-1')).thenAnswer((_) async {
      final next = answers[calls++];
      if (next is Exception) throw next;
      return next as LearnerDebriefView;
    });
    final c = make();
    addTearDown(c.dispose);
    await c.load();
    expect(c.view?.state, LearnerDebriefState.working);
    expect(calls, 1);

    await tester.pump(const Duration(seconds: 4));
    expect(calls, 1);
    await tester.pump(const Duration(seconds: 1));
    expect(calls, 2);
    // The blip didn't swap back to today's debrief, and polling continues.
    expect(c.view?.state, LearnerDebriefState.working);

    await tester.pump(const Duration(seconds: 5));
    expect(calls, 3);
    await tester.pump(const Duration(seconds: 5));
    expect(calls, 4);
    expect(c.view?.state, LearnerDebriefState.ready);

    // Ready: no more polling.
    await tester.pump(const Duration(seconds: 30));
    expect(calls, 4);
  });

  test('helpful shows the pressed state once the server accepts', () async {
    when(() => repo.getDebrief('s-1')).thenAnswer((_) async => LearnerDebriefView.fromJson(readyDebriefJson()));
    when(() => repo.setHelpful('s-1', helpful: true)).thenAnswer((_) async {});
    final c = make();
    await c.load();
    await c.setHelpful(true);
    expect(c.view!.helpful, isTrue);
    verify(() => repo.setHelpful('s-1', helpful: true)).called(1);
    c.dispose();
  });

  test('flagging shows the sent flag; undo takes it back; a failed flag throws', () async {
    // A tiny server: the re-read after each change reflects stored flags.
    final stored = <Map<String, dynamic>>[];
    when(() => repo.getDebrief('s-1')).thenAnswer(
      (_) async => LearnerDebriefView.fromJson({
        ...readyDebriefJson(),
        'feedback': {'helpful': null, 'flags': List.of(stored)},
      }),
    );
    final until = DateTime.now().add(const Duration(minutes: 10));
    when(
      () => repo.flagCard('s-1', section: 'what_worked[0]', reason: DebriefFlagReason.didntSay, note: null),
    ).thenAnswer((_) async {
      stored.add({'id': 'f1', 'section': 'what_worked[0]', 'status': 'open', 'canUndoUntil': until.toIso8601String()});
      return (id: 'f1', undoUntil: until);
    });
    when(() => repo.undoFlag('s-1', 'f1')).thenAnswer((_) async => stored.clear());
    final c = make();
    await c.load();

    await c.flagCard(section: 'what_worked[0]', reason: DebriefFlagReason.didntSay);
    expect(c.view!.flags.single.id, 'f1');
    await pumpEventQueue();
    expect(c.view!.flags.single.canUndoAt(DateTime.now()), isTrue);

    await c.undoFlag('f1');
    expect(c.view!.flags, isEmpty);
    await pumpEventQueue();
    expect(c.view!.flags, isEmpty);

    when(
      () => repo.flagCard('s-1', section: 'practise_next', reason: DebriefFlagReason.somethingElse, note: null),
    ).thenThrow(Conflict409());
    await expectLater(
      c.flagCard(section: 'practise_next', reason: DebriefFlagReason.somethingElse),
      throwsA(isA<Conflict409>()),
    );
    c.dispose();
  });
}

class Conflict409 implements Exception {}
