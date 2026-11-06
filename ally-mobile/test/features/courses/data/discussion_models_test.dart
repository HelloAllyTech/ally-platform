import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/discussion_models.dart';

void main() {
  group('DiscussionAuthor.fromJson', () {
    test('parses every field', () {
      final author = DiscussionAuthor.fromJson({
        'id': 42,
        'name': 'Priya',
        'profileImageUrl': 'https://cdn.example.com/a.png',
      });
      expect(author.id, 42);
      expect(author.name, 'Priya');
      expect(author.profileImageUrl, 'https://cdn.example.com/a.png');
    });

    test('profileImageUrl is null when absent', () {
      final author = DiscussionAuthor.fromJson({'id': 1, 'name': 'A'});
      expect(author.profileImageUrl, isNull);
    });
  });

  group('DiscussionPost.fromJson', () {
    test('parses a top-level post with nested replies', () {
      final post = DiscussionPost.fromJson({
        'id': 'p1',
        'parentPostId': null,
        'depth': 1,
        'author': {'id': 1, 'name': 'A', 'profileImageUrl': null},
        'content': 'Hello',
        'isDeletedByAuthor': false,
        'isEdited': true,
        'editedByModerator': false,
        'isLocked': false,
        'isOwn': true,
        'createdAt': '2026-01-01T00:00:00Z',
        'editedAt': '2026-01-02T00:00:00Z',
        'editableUntil': '2026-01-03T00:00:00Z',
        'canEdit': true,
        'canDelete': true,
        'canReply': true,
        'canLock': true,
        'replies': [
          {
            'id': 'p2',
            'parentPostId': 'p1',
            'depth': 2,
            'author': {'id': 2, 'name': 'B', 'profileImageUrl': null},
            'content': 'A reply',
            'createdAt': '2026-01-01T01:00:00Z',
            'replies': [],
          },
        ],
      });

      expect(post.id, 'p1');
      expect(post.parentPostId, isNull);
      expect(post.depth, 1);
      expect(post.author!.name, 'A');
      expect(post.isEdited, isTrue);
      expect(post.isOwn, isTrue);
      expect(post.editedAt, '2026-01-02T00:00:00Z');
      expect(post.editableUntil, '2026-01-03T00:00:00Z');
      expect(post.canEdit, isTrue);
      expect(post.canLock, isTrue);
      expect(post.replies, hasLength(1));
      expect(post.replies[0].id, 'p2');
      expect(post.replies[0].depth, 2);
      expect(post.replies[0].parentPostId, 'p1');
    });

    test('a post deleted by its author has a null author/content but keeps its replies', () {
      final post = DiscussionPost.fromJson({
        'id': 'p3',
        'parentPostId': null,
        'depth': 1,
        'author': null,
        'content': null,
        'isDeletedByAuthor': true,
        'createdAt': '2026-01-01T00:00:00Z',
        'replies': [
          {
            'id': 'p4',
            'parentPostId': 'p3',
            'depth': 2,
            'author': {'id': 1, 'name': 'A', 'profileImageUrl': null},
            'content': 'Still here',
            'createdAt': '2026-01-01T02:00:00Z',
            'replies': [],
          },
        ],
      });

      expect(post.author, isNull);
      expect(post.content, isNull);
      expect(post.isDeletedByAuthor, isTrue);
      expect(post.replies, hasLength(1));
    });

    test('defaults every boolean/permission flag to false and replies to empty when absent', () {
      final post = DiscussionPost.fromJson({
        'id': 'p5',
        'parentPostId': null,
        'depth': 1,
        'author': {'id': 1, 'name': 'A', 'profileImageUrl': null},
        'content': 'Minimal',
        'createdAt': '2026-01-01T00:00:00Z',
      });

      expect(post.isDeletedByAuthor, isFalse);
      expect(post.isEdited, isFalse);
      expect(post.editedByModerator, isFalse);
      expect(post.isLocked, isFalse);
      expect(post.isOwn, isFalse);
      expect(post.canEdit, isFalse);
      expect(post.canDelete, isFalse);
      expect(post.canReply, isFalse);
      expect(post.canLock, isFalse);
      expect(post.editedAt, isNull);
      expect(post.editableUntil, isNull);
      expect(post.replies, isEmpty);
    });
  });

  group('DiscussionViewer.fromJson', () {
    test('parses every field', () {
      final viewer = DiscussionViewer.fromJson({
        'userId': 7,
        'canModerate': true,
        'canPost': true,
        'maxDepth': 3,
        'maxLength': 500,
        'editWindowMinutes': 15,
      });
      expect(viewer.userId, 7);
      expect(viewer.canModerate, isTrue);
      expect(viewer.canPost, isTrue);
      expect(viewer.maxDepth, 3);
      expect(viewer.maxLength, 500);
      expect(viewer.editWindowMinutes, 15);
    });

    test('canModerate/canPost default to false when absent', () {
      final viewer = DiscussionViewer.fromJson({
        'userId': 1,
        'maxDepth': 3,
        'maxLength': 500,
        'editWindowMinutes': 15,
      });
      expect(viewer.canModerate, isFalse);
      expect(viewer.canPost, isFalse);
    });
  });

  group('DiscussionResponse.fromJson', () {
    test('parses a full discussion with posts', () {
      final response = DiscussionResponse.fromJson({
        'trackId': 't1',
        'trackItemId': 'i1',
        'tenantId': 'tenant-1',
        'enabled': true,
        'isLocked': false,
        'postCount': 2,
        'viewer': {
          'userId': 1,
          'canModerate': false,
          'canPost': true,
          'maxDepth': 3,
          'maxLength': 500,
          'editWindowMinutes': 15,
        },
        'posts': [
          {
            'id': 'p1',
            'parentPostId': null,
            'depth': 1,
            'author': {'id': 1, 'name': 'A', 'profileImageUrl': null},
            'content': 'First',
            'createdAt': '2026-01-01T00:00:00Z',
            'replies': [],
          },
        ],
      });

      expect(response.trackId, 't1');
      expect(response.trackItemId, 'i1');
      expect(response.tenantId, 'tenant-1');
      expect(response.enabled, isTrue);
      expect(response.postCount, 2);
      expect(response.viewer.maxLength, 500);
      expect(response.posts, hasLength(1));
    });

    test('disabled => posts/postCount/isLocked default sensibly when absent', () {
      final response = DiscussionResponse.fromJson({
        'trackId': 't2',
        'trackItemId': 'i2',
        'tenantId': 'tenant-1',
        'viewer': {
          'userId': 1,
          'maxDepth': 3,
          'maxLength': 500,
          'editWindowMinutes': 15,
        },
      });

      expect(response.enabled, isFalse);
      expect(response.isLocked, isFalse);
      expect(response.postCount, 0);
      expect(response.posts, isEmpty);
    });
  });
}
