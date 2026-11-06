import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';

void main() {
  group('ReviewAuthor.fromJson', () {
    test('parses all fields', () {
      final author = ReviewAuthor.fromJson({
        'id': 42,
        'name': 'Dr. Smith',
        'profileImage': 'https://example.com/a.png',
      });

      expect(author.id, 42);
      expect(author.name, 'Dr. Smith');
      expect(author.profileImage, 'https://example.com/a.png');
    });

    test('defaults profileImage to empty string when absent', () {
      final author = ReviewAuthor.fromJson({'id': 1, 'name': 'No Pic'});

      expect(author.profileImage, '');
    });

    test('accepts a numeric id passed as double', () {
      final author = ReviewAuthor.fromJson({
        'id': 42.0,
        'name': 'Dr. Smith',
      });

      expect(author.id, 42);
    });
  });

  group('ReviewItem.fromJson', () {
    test('parses all fields including nested createdBy', () {
      final review = ReviewItem.fromJson({
        'id': 'rev-1',
        'createdAt': '2026-01-01T00:00:00Z',
        'note': 'Please review this session',
        'createdBy': {'id': 7, 'name': 'Alex', 'profileImage': 'img.png'},
        'commentsCount': 3,
        'summaryName': 'Therapy session #4',
      });

      expect(review.id, 'rev-1');
      expect(review.createdAt, '2026-01-01T00:00:00Z');
      expect(review.note, 'Please review this session');
      expect(review.createdBy.id, 7);
      expect(review.createdBy.name, 'Alex');
      expect(review.commentsCount, 3);
      expect(review.summaryName, 'Therapy session #4');
    });

    test('defaults note/commentsCount and leaves summaryName null when missing', () {
      final review = ReviewItem.fromJson({
        'id': 'rev-2',
        'createdAt': '2026-01-01T00:00:00Z',
        'createdBy': {'id': 7, 'name': 'Alex'},
      });

      expect(review.note, '');
      expect(review.commentsCount, 0);
      expect(review.summaryName, isNull);
    });
  });

  group('ReviewThreadMessage.fromJson', () {
    test('parses all fields', () {
      final message = ReviewThreadMessage.fromJson({
        'id': 'm-1',
        'content': 'I feel anxious about this',
        'senderId': -1,
      });

      expect(message.id, 'm-1');
      expect(message.content, 'I feel anxious about this');
      expect(message.senderId, -1);
    });

    test('defaults content to empty and senderId to 0 when absent', () {
      final message = ReviewThreadMessage.fromJson({'id': 'm-2'});

      expect(message.content, '');
      expect(message.senderId, 0);
    });
  });

  group('ThreadComment.fromJson', () {
    test('parses reactions map and myReaction when present', () {
      final comment = ThreadComment.fromJson({
        'id': 't-1',
        'content': 'I agree',
        'createdAt': '2026-01-03T00:00:00Z',
        'createdBy': {'name': 'Morgan'},
        'reactions': {'👍': 2, '❤️': 1},
        'myReaction': '👍',
      });

      expect(comment.id, 't-1');
      expect(comment.content, 'I agree');
      expect(comment.createdAt, '2026-01-03T00:00:00Z');
      expect(comment.authorName, 'Morgan');
      expect(comment.reactions, {'👍': 2, '❤️': 1});
      expect(comment.myReaction, '👍');
    });

    test('defaults reactions to empty map and myReaction to null when absent', () {
      final comment = ThreadComment.fromJson({'id': 't-2'});

      expect(comment.content, '');
      expect(comment.authorName, 'Unknown');
      expect(comment.reactions, isEmpty);
      expect(comment.myReaction, isNull);
    });
  });

  group('ReviewThread.fromJson', () {
    test('parses with a present message anchor and comments list', () {
      final thread = ReviewThread.fromJson({
        'id': 'th-1',
        'comments': [
          {'id': 'c-1', 'content': 'root comment', 'createdBy': {'name': 'A'}},
        ],
        'commentCount': 5,
        'createdBy': {'id': 1, 'name': 'A'},
        'message': {'id': 'm-1', 'content': 'anchor text', 'senderId': -1},
      });

      expect(thread.id, 'th-1');
      expect(thread.comments, hasLength(1));
      expect(thread.comments.first.content, 'root comment');
      expect(thread.commentCount, 5);
      expect(thread.createdBy.name, 'A');
      expect(thread.message, isNotNull);
      expect(thread.message!.content, 'anchor text');
    });

    test('parses with an absent message anchor as null, and defaults comments/commentCount', () {
      final thread = ReviewThread.fromJson({
        'id': 'th-2',
        'createdBy': {'id': 2, 'name': 'B'},
        'message': null,
      });

      expect(thread.message, isNull);
      expect(thread.comments, isEmpty);
      expect(thread.commentCount, 0);
    });

    test('defaults comments to empty list when the key is missing entirely', () {
      final thread = ReviewThread.fromJson({
        'id': 'th-3',
        'createdBy': {'id': 3, 'name': 'C'},
      });

      expect(thread.comments, isEmpty);
      expect(thread.message, isNull);
    });
  });
}
