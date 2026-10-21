/// RN's `COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE` — a reply to the
/// learner's own course discussion post, the one notification type with
/// real tap-to-navigate behavior.
const kCourseDiscussionReplyNotificationType = 'COURSE_DISCUSSION_REPLY';

/// Mirrors ally-mobile (React Native)'s `src/services/notificationsApi.ts`
/// `NotificationItem`.
class NotificationItem {
  NotificationItem({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.readAt,
    required this.createdAt,
    this.data,
  });

  factory NotificationItem.fromJson(Map<String, dynamic> json) =>
      NotificationItem(
        id: json['id'] as String,
        type: json['type'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        readAt: json['readAt'] as String?,
        createdAt: json['createdAt'] as String,
        data: json['data'] as Map<String, dynamic>?,
      );

  final String id;
  final String type;
  final String title;
  final String body;
  final String? readAt;
  final String createdAt;

  /// Type-specific payload — e.g. `{trackId, itemId, postId}` for
  /// [kCourseDiscussionReplyNotificationType].
  final Map<String, dynamic>? data;

  bool get isRead => readAt != null;
}
