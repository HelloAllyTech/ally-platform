import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'discussion_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/discussionApi.ts`
/// — course discussion learner/moderator APIs for a thread attached to a
/// Track 2.0 item (see ally-be's `docs/course-discussions.md`). Every
/// mutation is addressed by `postId` alone server-side (not `itemId`);
/// callers re-fetch [getDiscussion] after a mutation to see the result,
/// the Riverpod-idiomatic equivalent of RTK Query's `invalidatesTags`.
///
/// Not ported: `getDiscussionModeratorTenants` — defined in RN's own
/// `discussionApi.ts` but never actually consumed by `DiscussionThread.tsx`
/// or any other RN screen (confirmed by grep), so there is no UI behavior
/// to port it for.
class DiscussionRepository {
  DiscussionRepository(this._dio);

  final Dio _dio;

  Future<DiscussionResponse> getDiscussion(String itemId) async {
    final response = await _dio.get<Map<String, dynamic>>('/learn/track-items/$itemId/discussion');
    return DiscussionResponse.fromJson(response.data!);
  }

  Future<DiscussionPost> createPost({required String itemId, required String content}) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/track-items/$itemId/discussion/posts',
      data: {'content': content},
    );
    return DiscussionPost.fromJson(response.data!);
  }

  Future<DiscussionPost> replyToPost({required String postId, required String content}) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/discussion/posts/$postId/replies',
      data: {'content': content},
    );
    return DiscussionPost.fromJson(response.data!);
  }

  Future<DiscussionPost> editPost({required String postId, required String content}) async {
    final response = await _dio.put<Map<String, dynamic>>(
      '/learn/discussion/posts/$postId',
      data: {'content': content},
    );
    return DiscussionPost.fromJson(response.data!);
  }

  Future<void> deletePost(String postId) async {
    await _dio.delete<void>('/learn/discussion/posts/$postId');
  }

  Future<DiscussionPost> lockPost({required String postId, required bool locked}) async {
    final response = await _dio.put<Map<String, dynamic>>(
      '/learn/discussion/posts/$postId/lock',
      data: {'locked': locked},
    );
    return DiscussionPost.fromJson(response.data!);
  }

  Future<void> lockDiscussion({required String itemId, required bool locked}) async {
    await _dio.put<void>('/learn/track-items/$itemId/discussion/lock', data: {'locked': locked});
  }
}

final discussionRepositoryProvider = Provider<DiscussionRepository>((ref) {
  return DiscussionRepository(ref.watch(apiClientProvider));
});

final discussionProvider = FutureProvider.family<DiscussionResponse, String>((ref, itemId) {
  return ref.watch(discussionRepositoryProvider).getDiscussion(itemId);
});
