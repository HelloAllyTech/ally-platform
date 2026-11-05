import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/push/leaderboard_notification.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/account/presentation/profile_settings_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/signed_in_auth.dart';

class _MockAccountRepository extends Mock implements AccountRepository {}

class _FakeScheduler implements LeaderboardNotificationScheduler {
  final calls = <String>[];
  @override
  Future<void> scheduleWeekly() async => calls.add('schedule');
  @override
  Future<void> cancel() async => calls.add('cancel');
}

UserProfile _user(String role) => UserProfile(
  id: 1,
  email: 'jane@example.com',
  name: 'Jane Doe',
  phone: '',
  profileImageUrl: null,
  profileCompleted: true,
  role: role,
);

void main() {
  testWidgets('learners get the Leaderboard Notification toggle, on by default; '
      'turning it off persists and cancels, back on schedules', (tester) async {
    final repository = _MockAccountRepository();
    when(() => repository.getUser()).thenAnswer((_) async => _user('LEARNER'));
    final scheduler = _FakeScheduler();

    await pumpRoutedApp(
      tester,
      initialLocation: '/profile',
      routes: [GoRoute(path: '/profile', builder: (_, _) => const ProfileSettingsScreen())],
      overrides: [
        accountRepositoryProvider.overrideWithValue(repository),
        leaderboardNotificationSchedulerProvider.overrideWithValue(scheduler),
        signedInAuthOverride(),
      ],
    );

    expect(find.text('Leaderboard Notification'), findsOneWidget);
    final switchFinder = find.byKey(const ValueKey('leaderboard-notification-switch'));
    expect(tester.widget<RnCustomSwitch>(switchFinder).value, isTrue);
    await tester.ensureVisible(switchFinder);
    await tester.pumpAndSettle();

    await tester.tap(switchFinder);
    await tester.pumpAndSettle();
    expect(tester.widget<RnCustomSwitch>(switchFinder).value, isFalse);
    expect(scheduler.calls, ['cancel']);
    expect((await SharedPreferences.getInstance()).getBool(leaderboardNotificationPrefsKey), isFalse);

    await tester.tap(switchFinder);
    await tester.pumpAndSettle();
    expect(scheduler.calls, ['cancel', 'schedule']);
  });

  testWidgets('non-learners do not see the toggle', (tester) async {
    final repository = _MockAccountRepository();
    when(() => repository.getUser()).thenAnswer((_) async => _user('COUNSELOR'));

    await pumpRoutedApp(
      tester,
      initialLocation: '/profile',
      routes: [GoRoute(path: '/profile', builder: (_, _) => const ProfileSettingsScreen())],
      overrides: [accountRepositoryProvider.overrideWithValue(repository), signedInAuthOverride()],
    );

    expect(find.text('Leaderboard Notification'), findsNothing);
  });
}
