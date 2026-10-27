import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/push/notification_navigation.dart';

void main() {
  group('isReminderNotification', () {
    test('true for the server-sent engagement-reminder type', () {
      expect(isReminderNotification({'type': 'ENGAGEMENT_REMINDER'}), isTrue);
    });

    test('false for an unrelated type, missing type, or null data', () {
      expect(isReminderNotification({'type': 'SOMETHING_ELSE'}), isFalse);
      expect(isReminderNotification({}), isFalse);
      expect(isReminderNotification(null), isFalse);
    });
  });

  group('reminderRouteFor', () {
    test('routes to Simulations when the payload hints at it', () {
      expect(reminderRouteFor({'type': 'ENGAGEMENT_REMINDER', 'screen': 'Simulations'}), '/simulations');
    });

    test('falls back to Notifications for an unrecognized or missing screen hint', () {
      expect(reminderRouteFor({'type': 'ENGAGEMENT_REMINDER', 'screen': 'SomethingElse'}), '/notifications');
      expect(reminderRouteFor({'type': 'ENGAGEMENT_REMINDER'}), '/notifications');
      expect(reminderRouteFor(null), '/notifications');
    });
  });

  group('routeForNotificationTap', () {
    test('a reminder notification routes per its screen hint', () {
      expect(
        routeForNotificationTap(data: {'type': 'ENGAGEMENT_REMINDER', 'screen': 'Simulations'}),
        '/simulations',
      );
      expect(routeForNotificationTap(data: {'type': 'ENGAGEMENT_REMINDER'}), '/notifications');
    });

    test('the leaderboard notification id routes to Leaderboard regardless of data', () {
      expect(routeForNotificationTap(notificationId: leaderboardNotificationId), '/leaderboard');
      expect(
        routeForNotificationTap(notificationId: leaderboardNotificationId, data: {'type': 'ENGAGEMENT_REMINDER'}),
        '/leaderboard',
      );
    });

    test('an unrecognized id with no reminder data routes nowhere', () {
      expect(routeForNotificationTap(), isNull);
      expect(routeForNotificationTap(notificationId: 'some-other-id'), isNull);
      expect(routeForNotificationTap(data: {'type': 'SOMETHING_ELSE'}), isNull);
    });
  });
}
