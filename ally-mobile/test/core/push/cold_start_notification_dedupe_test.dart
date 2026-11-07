import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/push/notification_navigation.dart';
import 'package:ally_mobile_flutter/core/push/push_notification_service.dart';

String _leaderboard(String scheduledAt) => jsonEncode({
      'id': leaderboardNotificationId,
      'data': {'scheduledAt': scheduledAt},
    });

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('a leaderboard reminder that launched the app is acted on once per scheduled instance', () async {
    expect(await claimColdStartNotificationTap(_leaderboard('1000')), isTrue);
    expect(await claimColdStartNotificationTap(_leaderboard('1000')), isFalse);
    expect(await claimColdStartNotificationTap(_leaderboard('2000')), isTrue, reason: "next week's instance");
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(leaderboardNotificationHandledKey), '2000');
  });

  test('other notifications always pass', () async {
    final reminder = jsonEncode({
      'id': 'r1',
      'data': {'type': 'reminder'},
    });
    expect(await claimColdStartNotificationTap(reminder), isTrue);
    expect(await claimColdStartNotificationTap(reminder), isTrue);
    expect(await claimColdStartNotificationTap(null), isTrue);
  });
}
