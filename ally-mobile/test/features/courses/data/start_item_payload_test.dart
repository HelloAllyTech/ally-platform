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

    test('parses a BRANCHING_SCENARIO payload', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-7',
        'type': 'BRANCHING_SCENARIO',
        'intro': 'A tough conversation awaits.',
        'startNodeId': 'n1',
        'nodes': [
          {
            'id': 'n1',
            'text': 'They look upset.',
            'choices': [
              {'id': 'c1', 'text': 'Ask what happened', 'nextNodeId': 'n2'},
            ],
          },
          {
            'id': 'n2',
            'text': 'They open up.',
            'outcome': 'POSITIVE',
            'score': 90,
            'takeaway': 'Listening helps.',
          },
        ],
        'passScore': 70,
        'maxAttempts': 3,
        'attemptsUsed': 1,
        'bestScore': 80,
        'completed': true,
        'endingsReached': ['n2'],
        'exhausted': false,
        'nextRoundAt': null,
        'recap': [],
      });

      expect(payload.type, 'BRANCHING_SCENARIO');
      expect(payload.branchingIntro, 'A tough conversation awaits.');
      expect(payload.branchingStartNodeId, 'n1');
      expect(payload.branchingNodes, hasLength(2));
      expect(payload.branchingNodes![0].isEnding, isFalse);
      expect(payload.branchingNodes![1].isEnding, isTrue);
      expect(payload.branchingNodes![1].outcome, BranchingOutcome.positive);
      expect(payload.branchingPassScore, 70);
      expect(payload.branchingMaxAttempts, 3);
      expect(payload.branchingAttemptsUsed, 1);
      expect(payload.branchingBestScore, 80);
      expect(payload.branchingCompleted, isTrue);
      expect(payload.branchingEndingsReached, ['n2']);
      expect(payload.branchingExhausted, isFalse);
      expect(payload.branchingNextRoundAt, isNull);
      expect(payload.branchingRecap, isEmpty);
      // Not gated to this type.
      expect(payload.gameKey, isNull);
      expect(payload.bucketSortBuckets, isNull);
    });

    test('BRANCHING_SCENARIO payload defaults attemptsUsed/completed/exhausted/endingsReached/recap when absent', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-7b',
        'type': 'BRANCHING_SCENARIO',
        'intro': null,
        'startNodeId': 'n1',
        'nodes': [
          {'id': 'n1', 'text': 'Scene one.'},
        ],
        'passScore': null,
        'maxAttempts': null,
      });

      expect(payload.branchingAttemptsUsed, 0);
      expect(payload.branchingCompleted, isFalse);
      expect(payload.branchingExhausted, isFalse);
      expect(payload.branchingEndingsReached, isEmpty);
      expect(payload.branchingRecap, isEmpty);
    });

    test('parses a BUCKET_SORT payload, stripping no answer key', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-8',
        'type': 'BUCKET_SORT',
        'bucketSort': {
          'intro': 'Sort these into the right buckets.',
          'buckets': [
            {'id': 'b1', 'label': 'Healthy', 'description': 'Good coping'},
            {'id': 'b2', 'label': 'Unhealthy'},
          ],
          'items': [
            {'id': 'i1', 'text': 'Deep breathing'},
            {'id': 'i2', 'text': 'Avoidance'},
          ],
          'answered': {
            'i2': {
              'correct': false,
              'placedBucketId': 'b1',
              'correctBucketId': 'b2',
              'explanation': 'Avoidance delays processing.',
            },
          },
        },
        'rounds': 2,
        'bestFirstTryPct': 75,
      });

      expect(payload.type, 'BUCKET_SORT');
      expect(payload.bucketSortIntro, 'Sort these into the right buckets.');
      expect(payload.bucketSortBuckets, hasLength(2));
      expect(payload.bucketSortBuckets![0].description, 'Good coping');
      expect(payload.bucketSortBuckets![1].description, isNull);
      expect(payload.bucketSortItems, hasLength(2));
      expect(payload.bucketSortAnswered, hasLength(1));
      expect(payload.bucketSortAnswered!['i2']!.correct, isFalse);
      expect(payload.bucketSortAnswered!['i2']!.correctBucketId, 'b2');
      expect(payload.bucketSortRounds, 2);
      expect(payload.bucketSortBestFirstTryPct, 75);
      // Not gated to this type.
      expect(payload.branchingNodes, isNull);
    });

    test('BUCKET_SORT payload defaults answered/rounds when absent', () {
      final payload = StartItemPayload.fromJson({
        'trackItemProgressId': 'prog-8b',
        'type': 'BUCKET_SORT',
        'bucketSort': {
          'buckets': [
            {'id': 'b1', 'label': 'Healthy'},
          ],
          'items': [
            {'id': 'i1', 'text': 'Deep breathing'},
          ],
        },
        'bestFirstTryPct': null,
      });

      expect(payload.bucketSortIntro, isNull);
      expect(payload.bucketSortAnswered, isEmpty);
      expect(payload.bucketSortRounds, 0);
      expect(payload.bucketSortBestFirstTryPct, isNull);
    });
  });

  group('BranchingNode.fromJson', () {
    test('a node with choices is not an ending', () {
      final node = BranchingNode.fromJson({
        'id': 'n1',
        'title': 'The call',
        'text': 'Your client seems distressed.',
        'image': {'url': 'https://cdn.example.com/a.png', 'alt': 'A scene'},
        'choices': [
          {'id': 'c1', 'text': 'Reassure them', 'nextNodeId': 'n2'},
        ],
      });

      expect(node.title, 'The call');
      expect(node.image!.url, 'https://cdn.example.com/a.png');
      expect(node.image!.alt, 'A scene');
      expect(node.choices, hasLength(1));
      expect(node.isEnding, isFalse);
      expect(node.outcome, isNull);
    });

    test('a node with no choices is an ending, and an empty choices list also counts', () {
      final noChoicesKey = BranchingNode.fromJson({'id': 'n2', 'text': 'The end.'});
      final emptyChoices = BranchingNode.fromJson({
        'id': 'n3',
        'text': 'Also the end.',
        'choices': <Map<String, dynamic>>[],
      });

      expect(noChoicesKey.isEnding, isTrue);
      expect(emptyChoices.isEnding, isTrue);
    });

    test('an unrecognized outcome string parses as null', () {
      final node = BranchingNode.fromJson({
        'id': 'n4',
        'text': 'End.',
        'outcome': 'SOMETHING_ELSE',
      });
      expect(node.outcome, isNull);
    });
  });

  group('BranchingResult.fromJson', () {
    test('parses every field', () {
      final result = BranchingResult.fromJson({
        'endingNodeId': 'n2',
        'score': 90,
        'passScore': 70,
        'passed': true,
        'attemptsUsed': 1,
        'maxAttempts': 3,
        'attemptsLeft': 2,
        'bestScore': 90,
        'endingsReached': ['n2'],
        'itemCompleted': true,
        'completion': {
          'completed': true,
          'sectionCompleted': false,
          'trackCompleted': false,
        },
        'exhausted': false,
        'nextRoundAt': null,
        'recap': [],
      });

      expect(result.endingNodeId, 'n2');
      expect(result.score, 90);
      expect(result.passed, isTrue);
      expect(result.attemptsLeft, 2);
      expect(result.itemCompleted, isTrue);
      expect(result.completion, isNotNull);
      expect(result.exhausted, isFalse);
    });

    test('defaults passed/attemptsUsed/itemCompleted/exhausted/endingsReached/recap when absent', () {
      final result = BranchingResult.fromJson({
        'endingNodeId': 'n1',
        'score': 20,
        'passScore': null,
        'attemptsLeft': null,
        'bestScore': null,
        'nextRoundAt': null,
      });

      expect(result.passed, isFalse);
      expect(result.attemptsUsed, 0);
      expect(result.attemptsLeft, isNull);
      expect(result.itemCompleted, isFalse);
      expect(result.exhausted, isFalse);
      expect(result.endingsReached, isEmpty);
      expect(result.completion, isNull);
      expect(result.recap, isEmpty);
    });

    test('a spent round carries a non-empty recap', () {
      final result = BranchingResult.fromJson({
        'endingNodeId': 'n3',
        'score': 40,
        'passScore': 70,
        'passed': false,
        'attemptsUsed': 3,
        'maxAttempts': 3,
        'attemptsLeft': 0,
        'endingsReached': ['n2', 'n3'],
        'itemCompleted': false,
        'exhausted': true,
        'nextRoundAt': '2026-11-01T00:00:00Z',
        'recap': [
          {'endingNodeId': 'n2', 'score': 90, 'at': '2026-10-30T00:00:00Z'},
          {'endingNodeId': 'n3', 'score': 40, 'at': '2026-10-30T01:00:00Z'},
        ],
      });

      expect(result.exhausted, isTrue);
      expect(result.nextRoundAt, '2026-11-01T00:00:00Z');
      expect(result.recap, hasLength(2));
      expect(result.recap[0].score, 90);
    });
  });

  group('BucketSortFeedback.fromJson', () {
    test('parses a correct placement with no explanation', () {
      final feedback = BucketSortFeedback.fromJson({
        'correct': true,
        'placedBucketId': 'b1',
        'correctBucketId': 'b1',
      });

      expect(feedback.correct, isTrue);
      expect(feedback.placedBucketId, 'b1');
      expect(feedback.correctBucketId, 'b1');
      expect(feedback.explanation, isNull);
    });

    test('parses an incorrect placement with an explanation', () {
      final feedback = BucketSortFeedback.fromJson({
        'correct': false,
        'placedBucketId': 'b1',
        'correctBucketId': 'b2',
        'explanation': 'This avoids rather than copes.',
      });

      expect(feedback.correct, isFalse);
      expect(feedback.correctBucketId, 'b2');
      expect(feedback.explanation, 'This avoids rather than copes.');
    });
  });

  group('BucketSortPlacementResult.fromJson', () {
    test('parses every field, including the inherited feedback fields', () {
      final result = BucketSortPlacementResult.fromJson({
        'sortItemId': 'i1',
        'correct': true,
        'placedBucketId': 'b1',
        'correctBucketId': 'b1',
        'explanation': null,
        'placedCount': 2,
        'totalCount': 4,
        'finished': false,
        'firstTryPct': null,
        'itemCompleted': false,
        'completion': null,
      });

      expect(result.sortItemId, 'i1');
      expect(result.correct, isTrue);
      expect(result.placedCount, 2);
      expect(result.totalCount, 4);
      expect(result.finished, isFalse);
      expect(result.firstTryPct, isNull);
      expect(result.itemCompleted, isFalse);
      expect(result.completion, isNull);
    });

    test('the last placement carries firstTryPct, itemCompleted and completion', () {
      final result = BucketSortPlacementResult.fromJson({
        'sortItemId': 'i4',
        'correct': true,
        'placedBucketId': 'b2',
        'correctBucketId': 'b2',
        'placedCount': 4,
        'totalCount': 4,
        'finished': true,
        'firstTryPct': 75,
        'itemCompleted': true,
        'completion': {
          'completed': true,
          'sectionCompleted': true,
          'trackCompleted': false,
        },
      });

      expect(result.finished, isTrue);
      expect(result.firstTryPct, 75);
      expect(result.itemCompleted, isTrue);
      expect(result.completion!.sectionCompleted, isTrue);
    });
  });
}
