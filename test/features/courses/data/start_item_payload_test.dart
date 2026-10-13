import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';

void main() {
  group('JournalPrompt.fromJson', () {
    test('parses every field', () {
      final prompt = JournalPrompt.fromJson({
        'id': 'p-1',
        'prompt': 'What are you grateful for?',
        'required': true,
        'placeholder': 'Type here...',
      });

      expect(prompt.id, 'p-1');
      expect(prompt.prompt, 'What are you grateful for?');
      expect(prompt.required, true);
      expect(prompt.placeholder, 'Type here...');
    });

    test('defaults required to false and placeholder to null', () {
      final prompt = JournalPrompt.fromJson({'id': 'p-2', 'prompt': 'Reflect'});
      expect(prompt.required, false);
      expect(prompt.placeholder, isNull);
    });
  });

  group('JournalSavedResponse.fromJson', () {
    test('parses promptId and response', () {
      final saved = JournalSavedResponse.fromJson({
        'promptId': 'p-1',
        'response': 'I am grateful for my family',
      });
      expect(saved.promptId, 'p-1');
      expect(saved.response, 'I am grateful for my family');
    });

    test('defaults response to empty string when missing', () {
      final saved = JournalSavedResponse.fromJson({'promptId': 'p-2'});
      expect(saved.response, '');
    });
  });

  group('ArticleQuestion.fromJson', () {
    test('parses every field including nested answered.selectedOptionId', () {
      final question = ArticleQuestion.fromJson({
        'id': 'aq-1',
        'prompt': 'What did you learn?',
        'options': [
          {'id': 'o1', 'text': 'Option 1'},
          {'id': 'o2', 'text': 'Option 2'},
        ],
        'answered': {'selectedOptionId': 'o1'},
        'correctOptionId': 'o2',
        'explanation': 'Because reasons',
      });

      expect(question.id, 'aq-1');
      expect(question.prompt, 'What did you learn?');
      expect(question.options, hasLength(2));
      expect(question.answeredOptionId, 'o1');
      expect(question.correctOptionId, 'o2');
      expect(question.explanation, 'Because reasons');
    });

    test('defaults options to empty list and answered/correct/explanation to null', () {
      final question = ArticleQuestion.fromJson({
        'id': 'aq-2',
        'prompt': 'Unanswered question',
      });

      expect(question.options, isEmpty);
      expect(question.answeredOptionId, isNull);
      expect(question.correctOptionId, isNull);
      expect(question.explanation, isNull);
    });
  });

  group('VideoInterjection.fromJson', () {
    test('parses every field including nested question and answered.passed', () {
      final interjection = VideoInterjection.fromJson({
        'id': 'int-1',
        'timestampSeconds': 42.5,
        'question': {
          'id': 'q-1',
          'type': 'true_false',
          'prompt': 'Still paying attention?',
        },
        'answered': {'passed': true},
      });

      expect(interjection.id, 'int-1');
      expect(interjection.timestampSeconds, 42.5);
      expect(interjection.question.id, 'q-1');
      expect(interjection.answeredPassed, true);
    });

    test('answeredPassed is null when answered is absent', () {
      final interjection = VideoInterjection.fromJson({
        'id': 'int-2',
        'timestampSeconds': 10,
        'question': {
          'id': 'q-2',
          'type': 'true_false',
          'prompt': 'Question',
        },
      });

      expect(interjection.timestampSeconds, 10.0);
      expect(interjection.answeredPassed, isNull);
    });
  });

  group('StartItemPayload.fromJson', () {
    test('parses a QUIZ payload', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-1',
        'type': 'QUIZ',
        'attemptsUsed': 1,
        'maxAttempts': 3,
        'quiz': {
          'settings': {'passScore': 70, 'maxAttempts': 3},
          'totalPoints': 10,
          'questions': [
            {
              'id': 'q-1',
              'type': 'mcq_single',
              'prompt': 'Pick one',
              'options': [
                {'id': 'a', 'text': 'A'},
              ],
            },
          ],
        },
      });

      expect(payload.trackItemProgressId, 'prog-1');
      expect(payload.type, 'QUIZ');
      expect(payload.attemptsUsed, 1);
      expect(payload.maxAttempts, 3);
      expect(payload.quiz, isNotNull);
      expect(payload.quiz!.questions, hasLength(1));
      // Non-matching-type fields stay null.
      expect(payload.html, isNull);
      expect(payload.articleQuestions, isNull);
      expect(payload.videoSource, isNull);
      expect(payload.interjections, isNull);
      expect(payload.journalPrompts, isNull);
      expect(payload.journalSavedResponses, isNull);
      expect(payload.gameKey, isNull);
    });

    test('parses an ARTICLE payload', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-2',
        'type': 'ARTICLE',
        'html': '<p>Some article content</p>',
        'minReadSeconds': 60,
        'questions': [
          {'id': 'aq-1', 'prompt': 'Reflect on it'},
        ],
      });

      expect(payload.type, 'ARTICLE');
      expect(payload.html, '<p>Some article content</p>');
      expect(payload.minReadSeconds, 60);
      expect(payload.articleQuestions, hasLength(1));
      expect(payload.quiz, isNull);
    });

    test('ARTICLE payload defaults articleQuestions to empty list when absent', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-2b',
        'type': 'ARTICLE',
        'html': '<p>No questions</p>',
      });

      expect(payload.articleQuestions, isEmpty);
    });

    test('parses a VIDEO payload with interjections', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-3',
        'type': 'VIDEO',
        'source': 's3',
        'url': 'https://cdn.example.com/video.mp4',
        'durationSeconds': 120.0,
        'requiredWatchPct': 80.0,
        'maxWatchedPct': 10.0,
        'interjections': [
          {
            'id': 'int-1',
            'timestampSeconds': 5,
            'question': {
              'id': 'q-1',
              'type': 'true_false',
              'prompt': 'Paying attention?',
            },
          },
        ],
      });

      expect(payload.type, 'VIDEO');
      expect(payload.videoSource, 's3');
      expect(payload.videoUrl, 'https://cdn.example.com/video.mp4');
      expect(payload.durationSeconds, 120.0);
      expect(payload.requiredWatchPct, 80.0);
      expect(payload.maxWatchedPct, 10.0);
      expect(payload.interjections, hasLength(1));
      expect(payload.quiz, isNull);
    });

    test('VIDEO payload defaults interjections to empty list when absent', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-3b',
        'type': 'VIDEO',
        'source': 'youtube',
        'url': 'https://youtube.com/watch?v=abc',
      });

      expect(payload.interjections, isEmpty);
    });

    test('parses a JOURNAL payload with prompts and saved responses', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-4',
        'type': 'JOURNAL',
        'prompts': [
          {'id': 'p-1', 'prompt': 'What went well?'},
        ],
        'savedResponses': [
          {'promptId': 'p-1', 'response': 'Everything'},
        ],
      });

      expect(payload.type, 'JOURNAL');
      expect(payload.journalPrompts, hasLength(1));
      expect(payload.journalSavedResponses, hasLength(1));
      expect(payload.journalSavedResponses![0].response, 'Everything');
    });

    test('JOURNAL payload defaults prompts/savedResponses to empty lists when absent', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-4b',
        'type': 'JOURNAL',
      });

      expect(payload.journalPrompts, isEmpty);
      expect(payload.journalSavedResponses, isEmpty);
    });

    test('parses a GAME payload', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-5',
        'type': 'GAME',
        'gameKey': 'breathing-exercise',
        'intro': 'Take a deep breath',
        'bestScore': 42,
      });

      expect(payload.type, 'GAME');
      expect(payload.gameKey, 'breathing-exercise');
      expect(payload.gameIntro, 'Take a deep breath');
      expect(payload.gameBestScore, 42);
    });

    test('fields gated on a different type stay null even if present in JSON', () {
      // e.g. a GAME payload won't carry a 'source' field in practice, but if
      // the type doesn't match, the gated field must stay null regardless.
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-6',
        'type': 'GAME',
        'source': 's3',
        'gameKey': 'ignore-source',
      });

      expect(payload.videoSource, isNull);
      expect(payload.gameKey, 'ignore-source');
    });
  });
}
