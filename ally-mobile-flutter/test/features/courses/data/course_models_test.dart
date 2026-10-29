import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';

void main() {
  group('trackItemTypeFromString', () {
    test('maps every known backend string', () {
      expect(trackItemTypeFromString('ROLEPLAY'), TrackItemType.roleplay);
      expect(trackItemTypeFromString('CASE'), TrackItemType.caseItem);
      expect(trackItemTypeFromString('QUIZ'), TrackItemType.quiz);
      expect(trackItemTypeFromString('ARTICLE'), TrackItemType.article);
      expect(trackItemTypeFromString('VIDEO'), TrackItemType.video);
      expect(trackItemTypeFromString('JOURNAL'), TrackItemType.journal);
      expect(trackItemTypeFromString('GAME'), TrackItemType.game);
    });

    test('falls back to unknown for an unrecognized or null string', () {
      expect(trackItemTypeFromString('SOMETHING_NEW'), TrackItemType.unknown);
      expect(trackItemTypeFromString(null), TrackItemType.unknown);
    });
  });

  group('trackItemStatusFromString', () {
    test('maps every known backend string', () {
      expect(trackItemStatusFromString('LOCKED'), TrackItemStatus.locked);
      expect(trackItemStatusFromString('UNLOCKED'), TrackItemStatus.unlocked);
      expect(trackItemStatusFromString('COMPLETED'), TrackItemStatus.completed);
    });

    test('falls back to unknown for an unrecognized or null string', () {
      expect(trackItemStatusFromString('WEIRD'), TrackItemStatus.unknown);
      expect(trackItemStatusFromString(null), TrackItemStatus.unknown);
    });
  });

  group('TrackListItem.fromJson', () {
    test('parses every field from a realistic payload', () {
      final item = TrackListItem.fromJson({
        'id': 'track-1',
        'title': 'Managing anxiety',
        'description': 'Intro track',
        'coverImageUrl': 'https://cdn.example.com/cover.png',
        'totalItems': 10,
        'completedItems': 4,
        'enrolled': true,
        'trackEnrollmentId': 'enr-1',
      });

      expect(item.id, 'track-1');
      expect(item.title, 'Managing anxiety');
      expect(item.description, 'Intro track');
      expect(item.coverImageUrl, 'https://cdn.example.com/cover.png');
      expect(item.totalItems, 10);
      expect(item.completedItems, 4);
      expect(item.enrolled, true);
      expect(item.trackEnrollmentId, 'enr-1');
    });

    test('defaults missing optional/numeric fields', () {
      final item = TrackListItem.fromJson({
        'id': 'track-2',
        'title': 'Bare minimum',
      });

      expect(item.description, isNull);
      expect(item.coverImageUrl, isNull);
      expect(item.totalItems, 0);
      expect(item.completedItems, 0);
      expect(item.enrolled, false);
      expect(item.trackEnrollmentId, isNull);
    });
  });

  group('TrackDetailItem.fromJson', () {
    test('parses every field from a realistic payload', () {
      final item = TrackDetailItem.fromJson({
        'id': 'item-1',
        'type': 'QUIZ',
        'order': 2,
        'title': 'Quiz: anxiety basics',
        'description': 'Check your understanding',
        'status': 'COMPLETED',
        'score': 85.5,
        'maxWatchedPct': 100.0,
      });

      expect(item.id, 'item-1');
      expect(item.type, TrackItemType.quiz);
      expect(item.order, 2);
      expect(item.title, 'Quiz: anxiety basics');
      expect(item.description, 'Check your understanding');
      expect(item.status, TrackItemStatus.completed);
      expect(item.score, 85.5);
      expect(item.maxWatchedPct, 100.0);
    });

    test('defaults missing optional/numeric fields and unknown type/status', () {
      final item = TrackDetailItem.fromJson({
        'id': 'item-2',
        'title': 'Untyped item',
      });

      expect(item.type, TrackItemType.unknown);
      expect(item.order, 0);
      expect(item.description, isNull);
      expect(item.status, TrackItemStatus.unknown);
      expect(item.score, isNull);
      expect(item.maxWatchedPct, isNull);
    });

    test('accepts integer score/maxWatchedPct and converts to double', () {
      final item = TrackDetailItem.fromJson({
        'id': 'item-3',
        'title': 'Integer scores',
        'score': 90,
        'maxWatchedPct': 50,
      });

      expect(item.score, 90.0);
      expect(item.maxWatchedPct, 50.0);
    });

    test('parses languageFallbackReason, completionCriteria, contentMeta, and startedAt', () {
      final item = TrackDetailItem.fromJson({
        'id': 'item-4',
        'title': 'Quiz with meta',
        'languageFallbackReason': 'VIDEO_NOT_LOCALISED',
        'completionCriteria': {'minScore': 70, 'passScore': 80},
        'contentMeta': {'questionCount': 5, 'durationSeconds': 120, 'promptCount': 3},
        'startedAt': '2026-01-01T00:00:00Z',
      });

      expect(item.languageFallbackReason, 'VIDEO_NOT_LOCALISED');
      expect(item.completionCriteria?.minScore, 70.0);
      expect(item.completionCriteria?.passScore, 80.0);
      expect(item.contentMeta?.questionCount, 5);
      expect(item.contentMeta?.durationSeconds, 120);
      expect(item.contentMeta?.promptCount, 3);
      expect(item.startedAt, '2026-01-01T00:00:00Z');
    });

    test('leaves the new optional fields null when the backend omits them', () {
      final item = TrackDetailItem.fromJson({'id': 'item-5', 'title': 'Bare item'});

      expect(item.languageFallbackReason, isNull);
      expect(item.completionCriteria, isNull);
      expect(item.contentMeta, isNull);
      expect(item.startedAt, isNull);
    });
  });

  group('TrackSection.fromJson', () {
    test('parses items list', () {
      final section = TrackSection.fromJson({
        'id': 'sec-1',
        'title': 'Week 1',
        'order': 1,
        'items': [
          {'id': 'item-1', 'title': 'Video intro'},
          {'id': 'item-2', 'title': 'Quiz'},
        ],
      });

      expect(section.id, 'sec-1');
      expect(section.title, 'Week 1');
      expect(section.order, 1);
      expect(section.items, hasLength(2));
      expect(section.items[0].id, 'item-1');
      expect(section.items[1].id, 'item-2');
    });

    test('defaults order and items when missing', () {
      final section = TrackSection.fromJson({
        'id': 'sec-2',
        'title': 'Empty week',
      });

      expect(section.order, 0);
      expect(section.items, isEmpty);
    });

    test('parses an optional description', () {
      final section = TrackSection.fromJson({
        'id': 'sec-3',
        'title': 'Week 3',
        'description': '<p>Warm-up</p>',
      });

      expect(section.description, '<p>Warm-up</p>');
    });
  });

  group('trackItemMetaText', () {
    String t(String key, [Map<String, Object?>? params]) {
      // Minimal stand-in translate function — exercises the real selection
      // logic (which key/branch is chosen, and with what params), not the
      // app's actual locale JSON, which `course_detail_screen_test.dart`'s
      // widget tests already cover end-to-end.
      if (params == null || params.isEmpty) return key;
      var result = key;
      for (final entry in params.entries) {
        result = '$result[${entry.key}=${entry.value}]';
      }
      return result;
    }

    TrackDetailItem itemOf(
      TrackItemType type, {
      TrackItemContentMeta? contentMeta,
      TrackCompletionCriteria? completionCriteria,
    }) => TrackDetailItem(
      id: 'i',
      type: type,
      order: 0,
      title: 'Item',
      description: null,
      status: TrackItemStatus.unlocked,
      score: null,
      maxWatchedPct: null,
      contentMeta: contentMeta,
      completionCriteria: completionCriteria,
    );

    test('QUIZ with no meta falls back to the bare "quiz" key', () {
      expect(trackItemMetaText(itemOf(TrackItemType.quiz), t), 'courses.meta.quiz');
    });

    test('QUIZ with a question count and pass score joins both parts', () {
      final item = itemOf(
        TrackItemType.quiz,
        contentMeta: TrackItemContentMeta(questionCount: 7, passScore: 70),
      );
      expect(
        trackItemMetaText(item, t),
        'courses.meta.questions_other[count=7] · courses.meta.passScore[score=70.0]',
      );
    });

    test('QUIZ passScore of 0 is a real threshold, not dropped as falsy', () {
      final item = itemOf(
        TrackItemType.quiz,
        contentMeta: TrackItemContentMeta(passScore: 0),
      );
      expect(trackItemMetaText(item, t), contains('passScore[score=0.0]'));
    });

    test('a single question uses the singular key', () {
      final item = itemOf(
        TrackItemType.quiz,
        contentMeta: TrackItemContentMeta(questionCount: 1),
      );
      expect(trackItemMetaText(item, t), 'courses.meta.questions_one[count=1]');
    });

    test('VIDEO with a duration rounds seconds to minutes', () {
      final item = itemOf(
        TrackItemType.video,
        contentMeta: TrackItemContentMeta(durationSeconds: 125),
      );
      // 125s rounds to 2 minutes.
      expect(
        trackItemMetaText(item, t),
        'courses.meta.videoDuration_other[count=2][minutes=2]',
      );
    });

    test('VIDEO with no duration falls back to the bare "video" key', () {
      expect(trackItemMetaText(itemOf(TrackItemType.video), t), 'courses.meta.video');
    });

    test('JOURNAL with a prompt count uses the plural key', () {
      final item = itemOf(
        TrackItemType.journal,
        contentMeta: TrackItemContentMeta(promptCount: 4),
      );
      expect(trackItemMetaText(item, t), 'courses.meta.prompts_other[count=4]');
    });

    test('ROLEPLAY with a real minScore threshold appends it', () {
      final item = itemOf(
        TrackItemType.roleplay,
        completionCriteria: TrackCompletionCriteria(minScore: 60),
      );
      expect(
        trackItemMetaText(item, t),
        'courses.meta.roleplay · courses.meta.minScore[score=60.0]',
      );
    });

    test('ROLEPLAY with an unconfigured (zero) minScore shows no threshold', () {
      final item = itemOf(
        TrackItemType.roleplay,
        completionCriteria: TrackCompletionCriteria(minScore: 0),
      );
      expect(trackItemMetaText(item, t), 'courses.meta.roleplay');
    });

    test('ARTICLE, CASE, GAME, BRANCHING_SCENARIO, and BUCKET_SORT each use their own bare key', () {
      expect(trackItemMetaText(itemOf(TrackItemType.article), t), 'courses.meta.article');
      expect(trackItemMetaText(itemOf(TrackItemType.caseItem), t), 'courses.meta.case');
      expect(trackItemMetaText(itemOf(TrackItemType.game), t), 'courses.meta.game');
      expect(
        trackItemMetaText(itemOf(TrackItemType.branchingScenario), t),
        'courses.meta.branchingScenario',
      );
      expect(trackItemMetaText(itemOf(TrackItemType.bucketSort), t), 'courses.meta.bucketSort');
    });

    test('an unknown type has no meta line', () {
      expect(trackItemMetaText(itemOf(TrackItemType.unknown), t), '');
    });
  });

  group('findNextItemId', () {
    TrackDetailItem itemOf(String id, TrackItemStatus status, {String? startedAt}) =>
        TrackDetailItem(
          id: id,
          type: TrackItemType.article,
          order: 0,
          title: id,
          description: null,
          status: status,
          score: null,
          maxWatchedPct: null,
          startedAt: startedAt,
        );

    TrackDetail detailOf(List<TrackSection> sections) => TrackDetail(
      id: 't1',
      title: 'Track',
      description: null,
      coverImageUrl: null,
      status: 'IN_PROGRESS',
      totalItems: 0,
      completedItems: 0,
      enrolled: true,
      trackEnrollmentId: null,
      sections: sections,
    );

    test('prefers an already-in-progress unlocked item over a plain unlocked one', () {
      final detail = detailOf([
        TrackSection(
          id: 's1',
          title: 'S1',
          order: 0,
          items: [
            itemOf('a', TrackItemStatus.completed),
            itemOf('b', TrackItemStatus.unlocked),
            itemOf('c', TrackItemStatus.unlocked, startedAt: '2026-01-01T00:00:00Z'),
          ],
        ),
      ]);

      expect(findNextItemId(detail), 'c');
    });

    test('falls back to the first plain unlocked item when nothing is in progress', () {
      final detail = detailOf([
        TrackSection(
          id: 's1',
          title: 'S1',
          order: 0,
          items: [
            itemOf('a', TrackItemStatus.locked),
            itemOf('b', TrackItemStatus.unlocked),
          ],
        ),
      ]);

      expect(findNextItemId(detail), 'b');
    });

    test('searches section by section in order, not just within one section', () {
      final detail = detailOf([
        TrackSection(id: 's1', title: 'S1', order: 0, items: [itemOf('a', TrackItemStatus.completed)]),
        TrackSection(id: 's2', title: 'S2', order: 1, items: [itemOf('b', TrackItemStatus.unlocked)]),
      ]);

      expect(findNextItemId(detail), 'b');
    });

    test('returns null when nothing is unlocked', () {
      final detail = detailOf([
        TrackSection(id: 's1', title: 'S1', order: 0, items: [itemOf('a', TrackItemStatus.locked)]),
      ]);

      expect(findNextItemId(detail), isNull);
    });
  });

  group('TrackDetail.fromJson', () {
    test('parses every field including nested sections', () {
      final detail = TrackDetail.fromJson({
        'id': 'track-1',
        'title': 'Managing anxiety',
        'description': 'Full track',
        'status': 'IN_PROGRESS',
        'totalItems': 5,
        'completedItems': 2,
        'enrolled': true,
        'trackEnrollmentId': 'enr-9',
        'sections': [
          {
            'id': 'sec-1',
            'title': 'Week 1',
            'order': 1,
            'items': [
              {'id': 'item-1', 'title': 'Video intro'},
            ],
          },
        ],
      });

      expect(detail.id, 'track-1');
      expect(detail.title, 'Managing anxiety');
      expect(detail.description, 'Full track');
      expect(detail.status, 'IN_PROGRESS');
      expect(detail.totalItems, 5);
      expect(detail.completedItems, 2);
      expect(detail.enrolled, true);
      expect(detail.trackEnrollmentId, 'enr-9');
      expect(detail.sections, hasLength(1));
      expect(detail.sections[0].items, hasLength(1));
    });

    test('defaults missing fields', () {
      final detail = TrackDetail.fromJson({
        'id': 'track-2',
        'title': 'Bare track',
      });

      expect(detail.description, isNull);
      expect(detail.status, '');
      expect(detail.totalItems, 0);
      expect(detail.completedItems, 0);
      expect(detail.enrolled, false);
      expect(detail.trackEnrollmentId, isNull);
      expect(detail.sections, isEmpty);
      // Optional on purpose — an older backend simply omits these.
      expect(detail.languageCode, isNull);
      expect(detail.availableLanguages, isEmpty);
    });

    test('parses languageCode and availableLanguages when present', () {
      final detail = TrackDetail.fromJson({
        'id': 'track-3',
        'title': 'Bilingual track',
        'languageCode': 'hi',
        'availableLanguages': [
          {'languageId': 1, 'languageCode': 'en', 'label': 'English', 'isSource': true},
          {'languageId': 2, 'languageCode': 'hi', 'label': 'Hindi', 'isSource': false},
        ],
      });

      expect(detail.languageCode, 'hi');
      expect(detail.availableLanguages, hasLength(2));
      expect(detail.availableLanguages[0].isSource, isTrue);
      expect(detail.availableLanguages[1].languageCode, 'hi');
    });
  });

  group('TrackLanguageOption.fromJson', () {
    test('parses every field, defaulting isSource to false', () {
      final option = TrackLanguageOption.fromJson({
        'languageId': 2,
        'languageCode': 'hi',
        'label': 'Hindi',
      });

      expect(option.languageId, 2);
      expect(option.languageCode, 'hi');
      expect(option.label, 'Hindi');
      expect(option.isSource, isFalse);
    });
  });

  group('NextTrackItem.fromJson', () {
    test('parses the base item fields plus sectionId/sectionTitle', () {
      final item = NextTrackItem.fromJson({
        'id': 'item-9',
        'type': 'VIDEO',
        'order': 3,
        'title': 'Next up',
        'status': 'UNLOCKED',
        'sectionId': 'sec-2',
        'sectionTitle': 'Week 2',
      });

      expect(item.id, 'item-9');
      expect(item.type, TrackItemType.video);
      expect(item.sectionId, 'sec-2');
      expect(item.sectionTitle, 'Week 2');
    });
  });

  group('GetNextTrackItemResponse.fromJson', () {
    test('parses a found next item', () {
      final response = GetNextTrackItemResponse.fromJson({
        'trackCompleted': false,
        'nextItem': {
          'id': 'item-1',
          'type': 'ARTICLE',
          'order': 1,
          'title': 'Intro',
          'status': 'UNLOCKED',
          'sectionId': 'sec-1',
          'sectionTitle': 'Week 1',
        },
      });

      expect(response.trackCompleted, isFalse);
      expect(response.nextItem, isNotNull);
      expect(response.nextItem!.id, 'item-1');
    });

    test('a completed track has no nextItem, and defaults trackCompleted to false when absent', () {
      final response = GetNextTrackItemResponse.fromJson({'nextItem': null});

      expect(response.trackCompleted, isFalse);
      expect(response.nextItem, isNull);
    });
  });

  group('TrackProgressDashboard.fromJson', () {
    test('parses every field', () {
      final progress = TrackProgressDashboard.fromJson({
        'trackId': 'track-1',
        'title': 'Managing anxiety',
        'totalItems': 10,
        'completedItems': 6,
        'completionPct': 60.0,
      });

      expect(progress.trackId, 'track-1');
      expect(progress.title, 'Managing anxiety');
      expect(progress.totalItems, 10);
      expect(progress.completedItems, 6);
      expect(progress.completionPct, 60.0);
    });

    test('defaults missing numeric fields', () {
      final progress = TrackProgressDashboard.fromJson({
        'trackId': 'track-2',
        'title': 'No stats yet',
      });

      expect(progress.totalItems, 0);
      expect(progress.completedItems, 0);
      expect(progress.completionPct, 0);
    });
  });
}
