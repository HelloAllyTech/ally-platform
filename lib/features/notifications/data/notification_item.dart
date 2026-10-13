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
  });

  factory NotificationItem.fromJson(Map<String, dynamic> json) =>
      NotificationItem(
        id: json['id'] as String,
        type: json['type'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        readAt: json['readAt'] as String?,
        createdAt: json['createdAt'] as String,
      );

  final String id;
  final String type;
  final String title;
  final String body;
  final String? readAt;
  final String createdAt;

  bool get isRead => readAt != null;
}
