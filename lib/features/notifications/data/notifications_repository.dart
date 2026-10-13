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

  Future<List<NotificationItem>> list({int limit = 25, int offset = 0}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/notifications',
      queryParameters: {'limit': limit, 'offset': offset},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => NotificationItem.fromJson(e as Map<String, dynamic>))
        .toList();
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
}

final notificationsRepositoryProvider = Provider<NotificationsRepository>((ref) {
  return NotificationsRepository(ref.watch(apiClientProvider));
});

final notificationsListProvider = FutureProvider<List<NotificationItem>>((ref) {
  return ref.watch(notificationsRepositoryProvider).list();
});
