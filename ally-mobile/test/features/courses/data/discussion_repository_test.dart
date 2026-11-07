import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/discussion_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/discussion_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
  data: data,
  statusCode: statusCode,
  requestOptions: RequestOptions(path: ''),
);

Map<String, dynamic> _postJson(String id) => {
  'id': id,
  'parentPostId': null,
  'depth': 1,
  'author': {'id': 1, 'name': 'A', 'profileImageUrl': null},
  'content': 'Hello',
  'createdAt': '2026-01-01T00:00:00Z',
  'replies': [],
};

void main() {
  late MockDio dio;
  late DiscussionRepository repository;

  setUp(() {
    dio = MockDio();
    repository = DiscussionRepository(dio);
  });

  group('getDiscussion', () {
    test('GETs /learn/track-items/{id}/discussion and parses the full response', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/track-items/item-1/discussion')).thenAnswer(
        (_) async => _response({
          'trackId': 't1',
          'trackItemId': 'item-1',
          'tenantId': 'tenant-1',
          'enabled': true,
          'isLocked': false,
          'postCount': 1,
          'viewer': {
            'userId': 1,
            'canModerate': false,
            'canPost': true,
            'maxDepth': 3,
            'maxLength': 500,
            'editWindowMinutes': 15,
          },
          'posts': [_postJson('p1')],
        }),
      );

      final result = await repository.getDiscussion('item-1');

      expect(result, isA<DiscussionResponse>());
      expect(result.trackItemId, 'item-1');
      expect(result.posts, hasLength(1));
      verify(() => dio.get<Map<String, dynamic>>('/learn/track-items/item-1/discussion')).called(1);
    });
  });

  group('createPost', () {
    test('POSTs the content and returns the new post', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/track-items/item-1/discussion/posts',
          data: {'content': 'New post'},
        ),
      ).thenAnswer((_) async => _response(_postJson('p1')));

      final result = await repository.createPost(itemId: 'item-1', content: 'New post');

      expect(result.id, 'p1');
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/track-items/item-1/discussion/posts',
          data: {'content': 'New post'},
        ),
      ).called(1);
    });
  });

  group('replyToPost', () {
    test('POSTs to the postId-addressed replies route', () async {
      when(
        () => dio.post<Map<String, dynamic>>('/learn/discussion/posts/p1/replies', data: {'content': 'A reply'}),
      ).thenAnswer((_) async => _response(_postJson('p2')));

      final result = await repository.replyToPost(postId: 'p1', content: 'A reply');

      expect(result.id, 'p2');
      verify(
        () => dio.post<Map<String, dynamic>>('/learn/discussion/posts/p1/replies', data: {'content': 'A reply'}),
      ).called(1);
    });
  });

  group('editPost', () {
    test('PUTs the new content to the postId-addressed route', () async {
      when(
        () => dio.put<Map<String, dynamic>>('/learn/discussion/posts/p1', data: {'content': 'Edited'}),
      ).thenAnswer((_) async => _response(_postJson('p1')));

      final result = await repository.editPost(postId: 'p1', content: 'Edited');

      expect(result.id, 'p1');
      verify(
        () => dio.put<Map<String, dynamic>>('/learn/discussion/posts/p1', data: {'content': 'Edited'}),
      ).called(1);
    });
  });

  group('deletePost', () {
    test('DELETEs the postId-addressed route', () async {
      when(() => dio.delete<void>('/learn/discussion/posts/p1')).thenAnswer((_) async => _response<void>(null));

      await repository.deletePost('p1');

      verify(() => dio.delete<void>('/learn/discussion/posts/p1')).called(1);
    });
  });

  group('lockPost', () {
    test('PUTs locked=true to the post lock route', () async {
      when(
        () => dio.put<Map<String, dynamic>>('/learn/discussion/posts/p1/lock', data: {'locked': true}),
      ).thenAnswer((_) async => _response(_postJson('p1')));

      final result = await repository.lockPost(postId: 'p1', locked: true);

      expect(result.id, 'p1');
      verify(
        () => dio.put<Map<String, dynamic>>('/learn/discussion/posts/p1/lock', data: {'locked': true}),
      ).called(1);
    });
  });

  group('lockDiscussion', () {
    test('PUTs locked=false to the whole-discussion lock route', () async {
      when(
        () => dio.put<void>('/learn/track-items/item-1/discussion/lock', data: {'locked': false}),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.lockDiscussion(itemId: 'item-1', locked: false);

      verify(
        () => dio.put<void>('/learn/track-items/item-1/discussion/lock', data: {'locked': false}),
      ).called(1);
    });
  });

  test('getModeratorTenants GETs /learn/track-items/:id/discussion/tenants', () async {
    when(() => dio.get<List<dynamic>>('/learn/track-items/item-1/discussion/tenants')).thenAnswer(
      (_) async => _response(<dynamic>[
        {'tenantId': 't1', 'tenantName': 'Org'},
      ]),
    );
    final tenants = await repository.getModeratorTenants('item-1');
    expect(tenants.single.tenantId, 't1');
    expect(tenants.single.tenantName, 'Org');
  });
}
