import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/notifications/data/notification_item.dart';

void main() {
  group('NotificationItem.fromJson', () {
    test('round-trips an unread notification', () {
      final json = {
        'id': 'n1',
        'type': 'SYSTEM',
        'title': 'New course available',
        'body': 'Check out the new Anxiety track.',
        'readAt': null,
        'createdAt': '2026-10-01T10:00:00.000Z',
      };

      final item = NotificationItem.fromJson(json);

      expect(item.id, 'n1');
      expect(item.type, 'SYSTEM');
      expect(item.title, 'New course available');
      expect(item.body, 'Check out the new Anxiety track.');
      expect(item.readAt, isNull);
      expect(item.createdAt, '2026-10-01T10:00:00.000Z');
      expect(item.isRead, isFalse);
    });

    test('round-trips a read notification', () {
      final json = {
        'id': 'n2',
        'type': 'REMINDER',
        'title': 'Session reminder',
        'body': 'Your session starts in 10 minutes.',
        'readAt': '2026-10-02T09:00:00.000Z',
        'createdAt': '2026-10-02T08:00:00.000Z',
      };

      final item = NotificationItem.fromJson(json);

      expect(item.readAt, '2026-10-02T09:00:00.000Z');
      expect(item.isRead, isTrue);
    });
  });
}
