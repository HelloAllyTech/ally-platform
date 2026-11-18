import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_api.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/comment_list_controller.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_conversation.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data) => Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

void main() {
  late MockDio dio;

  setUp(() => dio = MockDio());

  group('ReviewApi', () {
    test('starting a thread posts RN\'s {messageId, selection, content} to the simulation route', () async {
      when(() => dio.post<Map<String, dynamic>>(any(), data: any(named: 'data'))).thenAnswer(
        (_) async => _response<Map<String, dynamic>>({
          'comment': {'id': 'c-1', 'createdAt': '2026-10-28T10:00:00Z'},
          'thread': {'id': 't-1', 'createdAt': '2026-10-28T10:00:00Z'},
        }),
      );

      final result = await ReviewApi(dio, ReviewType.simulation).addComment(
        reviewId: 'rev-1',
        messageId: '42',
        selection: const ReviewTextSelection(startIndex: 4, endIndex: 9, selectedText: 'quick'),
        content: 'Nice',
      );

      verify(
        () => dio.post<Map<String, dynamic>>(
          '/scenario-session-reviews/rev-1/comments',
          data: {
            'messageId': 42,
            'selection': {'startIndex': 4, 'endIndex': 9, 'selectedText': 'quick'},
            'content': 'Nice',
          },
        ),
      ).called(1);
      expect(result.thread?.id, 't-1');
      expect(result.comment?.id, 'c-1');
      expect(result.reply, isNull);
    });

    test('scribe reviews use /scribe-session-reviews; replies send parentCommentId', () async {
      when(() => dio.post<Map<String, dynamic>>(any(), data: any(named: 'data'))).thenAnswer(
        (_) async => _response<Map<String, dynamic>>({
          'reply': {'id': 'r-1'},
        }),
      );

      final result = await ReviewApi(dio, ReviewType.scribe).addComment(
        reviewId: 'srev-1',
        parentCommentId: 'c-1',
        content: 'Agreed',
      );

      verify(
        () => dio.post<Map<String, dynamic>>(
          '/scribe-session-reviews/srev-1/comments',
          data: {'parentCommentId': 'c-1', 'content': 'Agreed'},
        ),
      ).called(1);
      expect(result.reply?.id, 'r-1');
    });

    test('Badges are refetched exactly where RN invalidates the tag', () async {
      when(() => dio.post<Map<String, dynamic>>(any(), data: any(named: 'data')))
          .thenAnswer((_) async => _response<Map<String, dynamic>>({}));
      when(() => dio.post<void>(any(), data: any(named: 'data'))).thenAnswer((_) async => _response<void>(null));
      when(() => dio.delete<void>(any())).thenAnswer((_) async => _response<void>(null));

      var sim = 0;
      final simApi = ReviewApi(dio, ReviewType.simulation, onBadgesChanged: () => sim++);
      await simApi.addComment(reviewId: 'r', content: 'x');
      await simApi.deleteComment('c');
      await simApi.addReactionToReview(reviewId: 'r', reaction: 'x', action: ReactionAction.add);
      await simApi.addReactionToComment(commentId: 'c', reaction: 'x', action: ReactionAction.add);
      expect(sim, 3);

      var scribe = 0;
      final scribeApi = ReviewApi(dio, ReviewType.scribe, onBadgesChanged: () => scribe++);
      await scribeApi.addComment(reviewId: 'r', content: 'x');
      await scribeApi.deleteComment('c');
      await scribeApi.addReactionToReview(reviewId: 'r', reaction: 'x', action: ReactionAction.add);
      expect(scribe, 1);
    });

    test('comments overview asks for the latest two, newest first (RN getGeneralCommentsOverview)', () async {
      when(
        () => dio.get<Map<String, dynamic>>(any(), queryParameters: any(named: 'queryParameters')),
      ).thenAnswer(
        (_) async => _response<Map<String, dynamic>>({
          'data': [
            {'id': 'c-1', 'content': 'hi', 'createdBy': {'id': 3, 'name': 'Rae'}, 'replyCount': 2},
          ],
          'count': 7,
        }),
      );

      final page = await ReviewApi(dio, ReviewType.scribe).getCommentsOverview('srev-1');

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews/srev-1/comments-overview',
          queryParameters: {'offset': 0, 'limit': 2, 'sortOrder': 'DESC', 'sortBy': 'createdAt'},
        ),
      ).called(1);
      expect(page.count, 7);
      expect(page.comments.single.replyCount, 2);
      expect(page.comments.single.authorName, 'Rae');
    });

    test('messages parse numeric ids and anchored thread selections', () async {
      when(
        () => dio.get<Map<String, dynamic>>(any(), queryParameters: any(named: 'queryParameters')),
      ).thenAnswer(
        (_) async => _response<Map<String, dynamic>>({
          'data': [
            {
              'id': 7,
              'content': 'The quick brown fox',
              'startSeconds': 65.4,
              'senderId': -1,
              'threads': [
                {
                  'id': 't-1',
                  'selection': {'startIndex': 4, 'endIndex': 9},
                  'comments': <dynamic>[],
                  'createdBy': {'id': 1, 'name': 'A'},
                },
              ],
            },
          ],
        }),
      );

      final messages = await ReviewApi(dio, ReviewType.simulation).getMessages('rev-1', offset: 10, limit: 10);

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/scenario-session-reviews/rev-1/messages',
          queryParameters: {'offset': 10, 'limit': 10},
        ),
      ).called(1);
      final message = messages.single;
      expect(message.id, '7');
      expect(message.isClient, isTrue);
      expect(message.parts.map((p) => p.text), ['The ', 'quick', ' brown fox']);
      expect(message.parts[1].commentIds, ['t-1']);
    });
  });

  group('splitByCommentRanges (RN utils/reviews.ts)', () {
    test('no ranges keeps the whole text as one plain part', () {
      final parts = splitByCommentRanges('hello', const []);
      expect(parts.single.text, 'hello');
      expect(parts.single.commentIds, isEmpty);
    });

    test('overlapping ranges tag the shared piece with both ids; out-of-range ends are clamped', () {
      final parts = splitByCommentRanges('abcdefghij', const [
        (id: 'a', start: 2, end: 6),
        (id: 'b', start: 4, end: 50),
        (id: 'empty', start: 3, end: 3),
      ]);
      expect([for (final p in parts) '${p.text}:${p.commentIds.join(',')}'], ['ab:', 'cd:a', 'ef:a,b', 'ghij:b']);
    });
  });

  group('selectionToMessageRange (RN IosCommentableText offsets)', () {
    const display = 'AI client: The quick brown fox';
    const prefixLength = 'AI client: '.length;

    test('subtracts the speaker prefix', () {
      final range = selectionToMessageRange(displayText: display, prefixLength: prefixLength, start: 15, end: 20);
      expect(range?.startIndex, 4);
      expect(range?.endIndex, 9);
      expect(range?.selectedText, 'quick');
    });

    test('clamps a selection that starts inside the prefix', () {
      final range = selectionToMessageRange(displayText: display, prefixLength: prefixLength, start: 3, end: 14);
      expect(range?.startIndex, 0);
      expect(range?.selectedText, 'The');
    });

    test('a selection entirely inside the prefix, or collapsed, is no selection', () {
      expect(selectionToMessageRange(displayText: display, prefixLength: prefixLength, start: 0, end: 5), isNull);
      expect(selectionToMessageRange(displayText: display, prefixLength: prefixLength, start: 15, end: 15), isNull);
    });
  });

  group('CommentListController.applyReaction (RN handleEmojiSelect counts)', () {
    ThreadComment comment(Map<String, int> reactions, String? mine) => ThreadComment(
      id: 'c',
      content: '',
      createdAt: null,
      authorName: '',
      reactions: reactions,
      myReaction: mine,
    );

    test('add, switch, and remove', () {
      final added = CommentListController.applyReaction(comment({}, null), null, '1f44d', ReactionAction.add);
      expect(added.reactions, {'1f44d': 1});
      expect(added.myReaction, '1f44d');

      final switched = CommentListController.applyReaction(added, '1f44d', '1f604', ReactionAction.update);
      expect(switched.reactions, {'1f604': 1});
      expect(switched.myReaction, '1f604');

      final removed = CommentListController.applyReaction(
        comment({'1f604': 2}, '1f604'),
        '1f604',
        '1f604',
        ReactionAction.remove,
      );
      expect(removed.reactions, {'1f604': 1});
      expect(removed.myReaction, isNull);
    });

    test('reactionActionFor mirrors getReactionAction', () {
      expect(reactionActionFor(null, 'x'), ReactionAction.add);
      expect(reactionActionFor('y', 'x'), ReactionAction.update);
      expect(reactionActionFor('x', 'x'), ReactionAction.remove);
    });
  });
}
