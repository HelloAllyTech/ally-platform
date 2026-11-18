import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/push/leaderboard_notification.dart';

class FakeScheduler implements LeaderboardNotificationScheduler {
  final calls = <String>[];

  @override
  Future<void> scheduleWeekly() async => calls.add('schedule');

  @override
  Future<void> cancel() async => calls.add('cancel');
}

class _TestAuth extends AuthController {
  @override
  AuthState build() => AuthState.unknown;

  void set(bool signedIn) => state = AuthState(isAuthenticated: signedIn);
}

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  group('nextWeeklyOccurrence (RN getNextScheduledNotificationTime)', () {
    DateTime next(DateTime now) => nextWeeklyOccurrence(now, dayOfWeek: 1, hour: 11, minute: 0);

    test('later the same Monday is today', () {
      expect(next(DateTime(2026, 10, 26, 9, 30)), DateTime(2026, 10, 26, 11));
    });
    test('after the time on Monday rolls to next Monday', () {
      expect(next(DateTime(2026, 10, 26, 11, 1)), DateTime(2026, 11, 2, 11));
    });
    test('exactly at the time rolls to next week (must be in the future)', () {
      expect(next(DateTime(2026, 10, 26, 11)), DateTime(2026, 11, 2, 11));
    });
    test('mid-week goes to the coming Monday', () {
      expect(next(DateTime(2026, 10, 28, 15)), DateTime(2026, 11, 2, 11));
    });
    test('JS Sunday (0) maps to DateTime.sunday', () {
      expect(
        nextWeeklyOccurrence(DateTime(2026, 10, 28), dayOfWeek: 0, hour: 9, minute: 15),
        DateTime(2026, 11, 1, 9, 15),
      );
    });
  });

  group('LeaderboardNotificationController', () {
    test('defaults to enabled; toggling persists and schedules/cancels', () async {
      SharedPreferences.setMockInitialValues({});
      final scheduler = FakeScheduler();
      final controller = LeaderboardNotificationController(scheduler);

      expect(await controller.isEnabled(), isTrue);

      await controller.setEnabled(false);
      expect(scheduler.calls, ['cancel']);
      expect((await SharedPreferences.getInstance()).getBool(leaderboardNotificationPrefsKey), isFalse);
      expect(await controller.isEnabled(), isFalse);

      await controller.scheduleIfEnabled();
      expect(scheduler.calls, ['cancel'], reason: 'disabled: nothing scheduled');

      await controller.setEnabled(true);
      expect(scheduler.calls, ['cancel', 'schedule']);
    });
  });

  group('leaderboardNotificationSyncProvider', () {
    ProviderContainer make(FakeScheduler scheduler, List<String> permissions) {
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(_TestAuth.new),
          userPermissionsProvider.overrideWith((ref) async => permissions),
          leaderboardNotificationSchedulerProvider.overrideWithValue(scheduler),
        ],
      );
      addTearDown(container.dispose);
      container.read(leaderboardNotificationSyncProvider);
      return container;
    }

    test('schedules on sign-in and cancels on sign-out', () async {
      SharedPreferences.setMockInitialValues({});
      final scheduler = FakeScheduler();
      final container = make(scheduler, [UserPermissions.viewCommunityLeaderboard]);
      final auth = container.read(authControllerProvider.notifier) as _TestAuth;

      await _flush();
      expect(scheduler.calls, isEmpty, reason: 'signed out at start');

      auth.set(true);
      await _flush();
      await _flush();
      expect(scheduler.calls, ['schedule']);

      auth.set(false);
      await _flush();
      expect(scheduler.calls, ['schedule', 'cancel']);
    });

    test('does not schedule without the leaderboard permission', () async {
      SharedPreferences.setMockInitialValues({});
      final scheduler = FakeScheduler();
      final container = make(scheduler, const []);
      (container.read(authControllerProvider.notifier) as _TestAuth).set(true);
      await _flush();
      await _flush();
      expect(scheduler.calls, isEmpty);
    });

    test('does not schedule when the user turned it off', () async {
      SharedPreferences.setMockInitialValues({leaderboardNotificationPrefsKey: false});
      final scheduler = FakeScheduler();
      final container = make(scheduler, [UserPermissions.viewCommunityLeaderboard]);
      (container.read(authControllerProvider.notifier) as _TestAuth).set(true);
      await _flush();
      await _flush();
      expect(scheduler.calls, isEmpty);
    });
  });
}
