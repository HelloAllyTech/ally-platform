import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/realtime/connectivity.dart';
import 'package:ally_mobile_flutter/features/achievements/data/achievements_repository.dart';
import 'package:ally_mobile_flutter/features/achievements/presentation/badge_popup.dart';

import '../../../support/fake_network_image.dart';
import '../../../support/fake_translations.dart';

class MockAchievementsRepository extends Mock implements AchievementsRepository {}

UserBadge _badge(String id, {String imageUrl = ''}) => UserBadge(
      id: 'ub-$id',
      badgeId: 'b-$id',
      name: 'Badge $id',
      description: 'Earned $id',
      imageUrl: imageUrl,
    );

void main() {
  late MockAchievementsRepository repository;

  setUp(() {
    repository = MockAchievementsRepository();
    when(() => repository.markBadgeAsViewed(any())).thenAnswer((_) async {});
  });

  Future<void> pumpHost(WidgetTester tester, {required bool active, Stream<bool>? offline}) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          fixedTranslationsOverride(),
          achievementsRepositoryProvider.overrideWithValue(repository),
          isOfflineProvider.overrideWith((ref) => offline ?? Stream.value(false)),
        ],
        child: MaterialApp(home: Scaffold(body: BadgePopupHost(active: active))),
      ),
    );
    await tester.pump();
  }

  testWidgets('queues unviewed badges: 1s to show, close marks viewed, next 650ms later', (tester) async {
    when(() => repository.getUnviewedBadges()).thenAnswer((_) async => [_badge('1'), _badge('2')]);
    await pumpHost(tester, active: true);

    expect(find.text('Badge 1'), findsNothing, reason: 'BADGE_INITIAL_SHOW_DELAY');
    await tester.pump(badgeInitialShowDelay);
    await tester.pump(); // translations resolve on first use
    expect(find.text('You earned a new badge'), findsOneWidget);
    expect(find.text('Badge 1'), findsOneWidget);
    expect(find.text('Earned 1'), findsOneWidget);

    // No image: RN never starts the auto-close timer (isLayoutReady stays false).
    await tester.pump(badgeAutoCloseDelay + const Duration(seconds: 1));
    expect(find.text('Badge 1'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('badge-popup-close')));
    await tester.pump();
    verify(() => repository.markBadgeAsViewed('b-1')).called(1);
    await tester.pump(badgeCloseAnimationDelay);
    expect(find.text('Badge 1'), findsNothing);

    await tester.pump(badgeNextBadgeDelay);
    expect(find.text('Badge 2'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('badge-popup-close')));
    await tester.pump(badgeCloseAnimationDelay + badgeNextBadgeDelay);
    verify(() => repository.markBadgeAsViewed('b-2')).called(1);
    expect(find.text('Badge 2'), findsNothing);

    // Tear down the 60s poll.
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('a badge with an image auto-closes after 5s and is marked viewed', (tester) async {
    await withFakeNetworkImages(() async {
      when(() => repository.getUnviewedBadges())
          .thenAnswer((_) async => [_badge('1', imageUrl: 'https://example.com/b.png')]);
      await pumpHost(tester, active: true);
      await tester.pump(badgeInitialShowDelay);
      await tester.pump();
      expect(find.text('Badge 1'), findsOneWidget);

      await tester.pump(badgeAutoCloseDelay);
      await tester.pump(badgeCloseAnimationDelay);
      verify(() => repository.markBadgeAsViewed('b-1')).called(1);
      expect(find.text('Badge 1'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });
  });

  testWidgets('does not poll while inactive; polls every 60s once active', (tester) async {
    when(() => repository.getUnviewedBadges()).thenAnswer((_) async => []);
    await pumpHost(tester, active: false);
    verifyNever(() => repository.getUnviewedBadges());

    await pumpHost(tester, active: true);
    verify(() => repository.getUnviewedBadges()).called(1);
    await tester.pump(badgePollingInterval);
    verify(() => repository.getUnviewedBadges()).called(1);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('refetches as soon as the network comes back (refetchOnReconnect)', (tester) async {
    when(() => repository.getUnviewedBadges()).thenAnswer((_) async => []);
    final offline = StreamController<bool>();
    addTearDown(offline.close);
    await pumpHost(tester, active: true, offline: offline.stream);
    verify(() => repository.getUnviewedBadges()).called(1);

    offline.add(true);
    await tester.pump();
    verifyNever(() => repository.getUnviewedBadges());
    offline.add(false);
    await tester.pump();
    verify(() => repository.getUnviewedBadges()).called(1);
    await tester.pumpWidget(const SizedBox());
  });
}
