import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'notification_item.dart';

/// Ported from ally-mobile (React Native)'s
/// `src/services/notificationsApi.ts`. Device-token registration (push)
/// is a separate concern wired once `firebase_messaging` is set up for
/// real push delivery — not done in this pass.
class NotificationsRepository {
  NotificationsRepository(this._dio);

  final Dio _dio;

  /// Matches RN's `NotificationFeedResponse` — a page of items plus the
  /// real total `count`, which is what makes "is there another page?"
  /// decidable (RN's own `hasMore = (data?.count ?? 0) > notifications.length`).
  Future<({List<NotificationItem> items, int count})> list({
    int limit = 25,
    int offset = 0,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/notifications',
      queryParameters: {'limit': limit, 'offset': offset},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return (
      items: data.map((e) => NotificationItem.fromJson(e as Map<String, dynamic>)).toList(),
      count: (response.data?['count'] as num?)?.toInt() ?? data.length,
    );
  }

  Future<int> unreadCount() async {
    final response =
        await _dio.get<Map<String, dynamic>>('/notifications/unread-count');
    return (response.data?['count'] as num?)?.toInt() ?? 0;
  }

  Future<void> markRead(String id) async {
    await _dio.patch<void>('/notifications/$id/read');
  }

  Future<void> markAllRead() async {
    await _dio.patch<void>('/notifications/read-all');
  }

  /// Matches ally-mobile (React Native)'s `registerDeviceToken` exactly:
  /// same route (PUT, idempotent — safe to call on every app start), same
  /// {token, platform} body shape.
  Future<void> registerDeviceToken({required String token, required String platform}) async {
    await _dio.put<void>(
      '/notifications/device-tokens',
      data: {'token': token, 'platform': platform},
    );
  }

  Future<void> deleteDeviceToken(String token) async {
    await _dio.delete<void>('/notifications/device-tokens/${Uri.encodeComponent(token)}');
  }
}

final notificationsRepositoryProvider = Provider<NotificationsRepository>((ref) {
  return NotificationsRepository(ref.watch(apiClientProvider));
});

/// Matches RN's own `PAGE_SIZE`.
const kNotificationsPageSize = 25;

class NotificationsPage {
  NotificationsPage({required this.items, required this.hasMore, this.isLoadingMore = false});

  final List<NotificationItem> items;
  final bool hasMore;
  final bool isLoadingMore;
}

/// Mirrors RN's own `onEndReached`/`hasMore` infinite-scroll pagination —
/// previously this screen only ever fetched a single fixed page.
class NotificationsController extends AsyncNotifier<NotificationsPage> {
  @override
  Future<NotificationsPage> build() async {
    final result = await ref.watch(notificationsRepositoryProvider).list(limit: kNotificationsPageSize);
    return NotificationsPage(items: result.items, hasMore: result.items.length < result.count);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncData(NotificationsPage(items: current.items, hasMore: current.hasMore, isLoadingMore: true));
    try {
      final result = await ref.read(notificationsRepositoryProvider).list(
            limit: kNotificationsPageSize,
            offset: current.items.length,
          );
      final items = [...current.items, ...result.items];
      state = AsyncData(NotificationsPage(items: items, hasMore: items.length < result.count));
    } catch (_) {
      // Stays retryable — the next scroll-to-bottom triggers another attempt.
      state = AsyncData(NotificationsPage(items: current.items, hasMore: current.hasMore));
    }
  }
}

final notificationsControllerProvider =
    AsyncNotifierProvider<NotificationsController, NotificationsPage>(NotificationsController.new);
