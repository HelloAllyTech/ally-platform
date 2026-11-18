import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import '../auth/auth_state.dart';
import '../permissions/permissions_repository.dart';
import '../permissions/user_permissions.dart';
import '../routing/app_router.dart';
import 'notification_navigation.dart';
import 'push_notification_service.dart';

/// Port of ally-mobile (React Native)'s weekly community-leaderboard
/// reminder: `src/services/notificationService.ts` (Notifee weekly
/// TIMESTAMP trigger), `hooks/useLeaderboardNotification.ts` (the
/// on-by-default AsyncStorage flag + toggle) and `RootNavigator.tsx`'s
/// schedule-on-auth effect.

/// RN's `LEADERBOARD_CHANNEL_ID` — same Android channel id as the RN app.
const String leaderboardChannelId = 'leaderboard';

/// `flutter_local_notifications` needs an int id; the string id RN uses
/// ([leaderboardNotificationId]) travels in the payload for tap routing.
const int leaderboardNotificationIntId = 74210;

/// RN's `AsyncStorageKeys.LEADERBOARD_NOTIFICATION_ENABLED` (null = never
/// set = ON).
const String leaderboardNotificationPrefsKey = 'LEADERBOARD_NOTIFICATION_ENABLED';

/// RN's `env.NOTIFICATION_SCHEDULE_DAY/HOUR/MINUTE` (`src/config/env.ts`
/// defaults, also what every RN `.env` sets): Monday 11:00 device-local.
/// Day uses RN's JS numbering, 0 = Sunday … 6 = Saturday.
const int leaderboardScheduleDay = int.fromEnvironment('NOTIFICATION_SCHEDULE_DAY', defaultValue: 1);
const int leaderboardScheduleHour = int.fromEnvironment('NOTIFICATION_SCHEDULE_HOUR', defaultValue: 11);
const int leaderboardScheduleMinute = int.fromEnvironment('NOTIFICATION_SCHEDULE_MINUTE', defaultValue: 0);

/// RN's `getNextScheduledNotificationTime`: the next [dayOfWeek] (JS
/// numbering) at [hour]:[minute] on or after [now] — today if it's that day
/// and the time hasn't passed, otherwise the coming one. Unlike RN, a time
/// that is not strictly in the future rolls to next week (the plugin refuses
/// past dates; RN's minute-granularity check allowed "now").
DateTime nextWeeklyOccurrence(
  DateTime now, {
  required int dayOfWeek,
  required int hour,
  required int minute,
}) {
  final targetWeekday = dayOfWeek == 0 ? DateTime.sunday : dayOfWeek;
  final daysToAdd = (targetWeekday - now.weekday + 7) % 7;
  var target = DateTime(now.year, now.month, now.day + daysToAdd, hour, minute);
  if (!target.isAfter(now)) {
    target = DateTime(target.year, target.month, target.day + 7, hour, minute);
  }
  return target;
}

/// The OS side — a seam so tests can use a fake.
abstract class LeaderboardNotificationScheduler {
  Future<void> scheduleWeekly();
  Future<void> cancel();
}

/// The real scheduler: one `zonedSchedule` repeating on
/// [DateTimeComponents.dayOfWeekAndTime], RN's `RepeatFrequency.WEEKLY`.
class LocalLeaderboardNotificationScheduler implements LeaderboardNotificationScheduler {
  LocalLeaderboardNotificationScheduler(this._router);

  final GoRouter Function() _router;
  static bool _timezoneReady = false;

  Future<void> _ensureTimezone() async {
    if (_timezoneReady) return;
    tz_data.initializeTimeZones();
    final local = await FlutterTimezone.getLocalTimezone();
    tz.setLocalLocation(tz.getLocation(local.identifier));
    _timezoneReady = true;
  }

  @override
  Future<void> scheduleWeekly() async {
    await initializeLocalNotifications(_router());
    final android = localNotificationsPlugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    // RN's createAndroidChannel + requestNotificationPermission (iOS asks
    // during initializeLocalNotifications).
    await android?.createNotificationChannel(
      const AndroidNotificationChannel(
        leaderboardChannelId,
        'Community Leaderboard',
        importance: Importance.high,
      ),
    );
    await android?.requestNotificationsPermission();
    await _ensureTimezone();

    final next = nextWeeklyOccurrence(
      tz.TZDateTime.now(tz.local),
      dayOfWeek: leaderboardScheduleDay,
      hour: leaderboardScheduleHour,
      minute: leaderboardScheduleMinute,
    );
    final scheduledDate = tz.TZDateTime(tz.local, next.year, next.month, next.day, next.hour, next.minute);

    await localNotificationsPlugin.zonedSchedule(
      id: leaderboardNotificationIntId,
      // RN hardcodes this copy (not translated).
      title: 'Ally',
      body: 'Time to view weekly community leaderboard',
      scheduledDate: scheduledDate,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          leaderboardChannelId,
          'Community Leaderboard',
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: DarwinNotificationDetails(),
      ),
      // Inexact, like Notifee's default trigger: no exact-alarm permission.
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
      payload: jsonEncode({
        'id': leaderboardNotificationId,
        'data': {'scheduledAt': scheduledDate.millisecondsSinceEpoch.toString()},
      }),
    );
  }

  @override
  Future<void> cancel() => localNotificationsPlugin.cancel(id: leaderboardNotificationIntId);
}

final leaderboardNotificationSchedulerProvider = Provider<LeaderboardNotificationScheduler>(
  (ref) => LocalLeaderboardNotificationScheduler(() => ref.read(appRouterProvider)),
);

/// The persisted on/off flag plus its schedule/cancel side effects. All OS
/// failures are swallowed: a reminder that can't be scheduled must never
/// break sign-in or the settings screen.
class LeaderboardNotificationController {
  LeaderboardNotificationController(this._scheduler);

  final LeaderboardNotificationScheduler _scheduler;

  Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(leaderboardNotificationPrefsKey) ?? true;
  }

  /// RN's `handleLeaderboardNotifToggle`.
  Future<void> setEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(leaderboardNotificationPrefsKey, enabled);
    await (enabled ? _guard(_scheduler.scheduleWeekly) : _guard(_scheduler.cancel));
  }

  /// RN's RootNavigator effect on auth: schedule when the flag is on.
  Future<void> scheduleIfEnabled() async {
    if (await isEnabled()) await _guard(_scheduler.scheduleWeekly);
  }

  Future<void> cancel() => _guard(_scheduler.cancel);

  Future<void> _guard(Future<void> Function() op) async {
    try {
      await op();
    } catch (e) {
      debugPrint('LeaderboardNotification: $e');
    }
  }
}

final leaderboardNotificationControllerProvider = Provider<LeaderboardNotificationController>(
  (ref) => LeaderboardNotificationController(ref.watch(leaderboardNotificationSchedulerProvider)),
);

/// The settings toggle's state (RN `useLeaderboardNotification`).
class LeaderboardNotificationEnabled extends AsyncNotifier<bool> {
  @override
  Future<bool> build() => ref.read(leaderboardNotificationControllerProvider).isEnabled();

  Future<void> toggle(bool enabled) async {
    state = AsyncData(enabled);
    await ref.read(leaderboardNotificationControllerProvider).setEnabled(enabled);
  }
}

final leaderboardNotificationEnabledProvider =
    AsyncNotifierProvider<LeaderboardNotificationEnabled, bool>(LeaderboardNotificationEnabled.new);

/// Watched once from the app root. On every sign-in (including a restored
/// session at app start) schedules the reminder if the flag is on and the
/// account can see the leaderboard (RN's VIEW_COMMUNITY_LEADERBOARD gate);
/// on sign-out cancels it so a signed-out device isn't reminded (RN never
/// cancels on logout — deliberate difference).
final leaderboardNotificationSyncProvider = Provider<void>((ref) {
  Future<void> onSignedIn() async {
    try {
      final permissions = await ref.read(userPermissionsProvider.future);
      if (!permissions.contains(UserPermissions.viewCommunityLeaderboard)) return;
    } catch (_) {
      return;
    }
    await ref.read(leaderboardNotificationControllerProvider).scheduleIfEnabled();
  }

  ref.listen<AuthState>(authControllerProvider, (previous, next) {
    final was = previous?.isAuthenticated ?? false;
    if (next.isAuthenticated && !was) {
      onSignedIn();
    } else if (!next.isAuthenticated && was) {
      ref.read(leaderboardNotificationControllerProvider).cancel();
    }
  }, fireImmediately: true);
});
