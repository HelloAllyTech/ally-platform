import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/learner_debrief_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

/// A full `ready` body, as the backend serves it.
Map<String, dynamic> readyDebriefJson() => {
  'state': 'ready',
  'runId': 'run-1',
  'language': 'en',
  'cards': {
    'opening': 'You stayed with her when it got hard.',
    'important_moment': {
      'turn_index': 7,
      'quote': 'I sometimes think it would be easier not to be here.',
      'handled_well': true,
      'lead': 'You asked about safety directly.',
      'body': 'Asking plainly showed you could hear it.',
      'others': [
        {'turn_index': 12, 'quote': 'Nobody would notice.', 'note': 'Another cue worth checking.'},
      ],
    },
    'what_worked': [
      {'skill': 'Reflection', 'turn_index': 3, 'quote': 'It sounds lonely.', 'lead': 'You named the feeling.', 'body': 'She opened up.'},
      {'skill': 'Pacing', 'turn_index': 5, 'quote': 'Take your time.', 'lead': 'You slowed down.', 'body': 'It gave her room.'},
    ],
    'work_on_this': [
      {
        'skill': 'Open questions',
        'turn_index': 9,
        'quote': 'Did you talk to anyone?',
        'lead': 'A closed question shut the door.',
        'why': 'Yes/no questions end the thread.',
        'try_saying': 'Who have you been able to talk to?',
      },
    ],
    'practise_next': {'skill': 'Open questions', 'reason': 'It came up twice.'},
    'skill_words': [
      {'skill': 'Reflection', 'word': 'strength'},
      {'skill': 'Open questions', 'word': 'keep_practising'},
      {'skill': 'Summarising', 'word': 'didnt_come_up'},
      {'skill': 'Ignored', 'word': 'not_a_word'},
    ],
    'reflective_question': 'What made it hard to ask an open question?',
    'progress_note': 'Your reflections are getting sharper.',
  },
  'corrections': <Object>[],
  'feedback': {'helpful': null, 'flags': <Object>[]},
};

void main() {
  group('LearnerDebriefView.fromJson', () {
    test('parses every card', () {
      final view = LearnerDebriefView.fromJson(readyDebriefJson());
      final cards = view.cards!;
      expect(view.state, LearnerDebriefState.ready);
      expect(view.isShowable, isTrue);
      expect(cards.importantMoment!.others.single.note, 'Another cue worth checking.');
      expect(cards.whatWorked, hasLength(2));
      expect(cards.workOnThis.single.trySaying, 'Who have you been able to talk to?');
      expect(cards.practiseNext!.skill, 'Open questions');
      // An unknown skill word is dropped, not guessed.
      expect(cards.skillWords.map((e) => e.word), [
        DebriefSkillWord.strength,
        DebriefSkillWord.keepPractising,
        DebriefSkillWord.didntComeUp,
      ]);
      expect(cards.progressNote, 'Your reflections are getting sharper.');
      expect(view.helpful, isNull);
    });

    test('state mapping, and which answers replace today\'s debrief', () {
      LearnerDebriefView of(Map<String, dynamic> json) => LearnerDebriefView.fromJson(json);
      expect(of({'state': 'working', 'steps': ['a', 'b']}).steps, ['a', 'b']);
      expect(of({'state': 'working'}).isShowable, isTrue);
      expect(of({'state': 'on_its_way'}).state, LearnerDebriefState.onItsWay);
      expect(of({'state': 'too_short'}).state, LearnerDebriefState.tooShort);
      expect(of({'state': 'not_available'}).isShowable, isFalse);
      expect(of({'state': 'something_new'}).isShowable, isFalse);
      // `ready` without cards has nothing to render.
      expect(of({'state': 'ready'}).isShowable, isFalse);
    });

    test('corrections and the learner\'s own flags', () {
      final view = LearnerDebriefView.fromJson({
        ...readyDebriefJson(),
        'corrections': [
          {'section': 'what_worked[1]', 'outcome': 'removed', 'note': null, 'at': '2026-10-30T10:00:00Z'},
          {'section': 'practise_next', 'outcome': 'kept', 'note': 'It fits.', 'at': '2026-10-30T10:00:00Z'},
        ],
        'feedback': {
          'helpful': true,
          'flags': [
            {'id': 'f1', 'section': 'work_on_this[0]', 'status': 'open', 'canUndoUntil': '2026-10-30T10:10:00Z'},
          ],
        },
      });
      expect(view.corrections.first.removed, isTrue);
      expect(view.corrections.last.note, 'It fits.');
      expect(view.helpful, isTrue);
      final flag = view.flags.single;
      expect(flag.canUndoAt(DateTime.utc(2026, 10, 30, 10, 5)), isTrue);
      expect(flag.canUndoAt(DateTime.utc(2026, 10, 30, 10, 11)), isFalse);
    });
  });

  group('LearnerDebriefRepository', () {
    late MockDio dio;
    late LearnerDebriefRepository repository;

    setUp(() {
      dio = MockDio();
      repository = LearnerDebriefRepository(dio);
    });

    test('GET the session\'s debrief (AuthInterceptor adds /v1)', () async {
      when(() => dio.get<Map<String, dynamic>>('/debriefs/sessions/s-1'))
          .thenAnswer((_) async => _response({'state': 'not_available'}));
      final view = await repository.getDebrief('s-1');
      expect(view.state, LearnerDebriefState.notAvailable);
    });

    test('PUT helpful', () async {
      when(() => dio.put<void>(any(), data: any(named: 'data'))).thenAnswer((_) async => _response<void>(null));
      await repository.setHelpful('s-1', helpful: false);
      verify(() => dio.put<void>('/debriefs/sessions/s-1/helpful', data: {'helpful': false})).called(1);
    });

    test('POST a flag (note only when given) and read back its undo window', () async {
      when(() => dio.post<Map<String, dynamic>>(any(), data: any(named: 'data')))
          .thenAnswer((_) async => _response({'id': 'f9', 'undoUntil': '2026-10-30T10:10:00Z'}));
      final result = await repository.flagCard('s-1', section: 'what_worked[0]', reason: DebriefFlagReason.didntSay);
      expect(result.id, 'f9');
      expect(result.undoUntil, DateTime.utc(2026, 10, 30, 10, 10));
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/debriefs/sessions/s-1/flags',
          data: {'section': 'what_worked[0]', 'reason': 'didnt_say'},
        ),
      ).called(1);

      await repository.flagCard('s-1', section: 'practise_next', reason: DebriefFlagReason.somethingElse, note: 'Hm');
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/debriefs/sessions/s-1/flags',
          data: {'section': 'practise_next', 'reason': 'something_else', 'note': 'Hm'},
        ),
      ).called(1);
    });

    test('DELETE a flag to undo it', () async {
      when(() => dio.delete<void>(any())).thenAnswer((_) async => _response<void>(null));
      await repository.undoFlag('s-1', 'f9');
      verify(() => dio.delete<void>('/debriefs/sessions/s-1/flags/f9')).called(1);
    });
  });
}
