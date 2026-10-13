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
