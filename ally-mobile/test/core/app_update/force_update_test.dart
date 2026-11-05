import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/app_update/force_update.dart';
import 'package:ally_mobile_flutter/core/app_update/force_update_modal.dart';

import '../../support/fake_translations.dart';

class MockForceUpdateRepository extends Mock implements ForceUpdateRepository {}

void main() {
  group('isVersionLower (RN utils/version.ts)', () {
    test('compares part by part, numerically', () {
      expect(isVersionLower('1.2.3', '1.2.4'), isTrue);
      expect(isVersionLower('1.2.10', '1.2.9'), isFalse);
      expect(isVersionLower('1.9.0', '1.10.0'), isTrue);
      expect(isVersionLower('2.0.0', '1.99.99'), isFalse);
    });

    test('equal is not lower; missing parts count as 0', () {
      expect(isVersionLower('1.2.3', '1.2.3'), isFalse);
      expect(isVersionLower('1.2', '1.2.0'), isFalse);
      expect(isVersionLower('1.2', '1.2.1'), isTrue);
    });

    test('a non-numeric part is skipped, like JS NaN', () {
      expect(isVersionLower('1.x.0', '1.2.1'), isTrue);
      expect(isVersionLower('1.x', '1.2'), isFalse);
    });
  });

  group('forceUpdateProvider', () {
    late MockForceUpdateRepository repository;

    ProviderContainer containerWith(String appVersion) {
      final container = ProviderContainer(
        overrides: [
          forceUpdateRepositoryProvider.overrideWithValue(repository),
          appVersionProvider.overrideWith((ref) async => appVersion),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    setUp(() => repository = MockForceUpdateRepository());

    test('requires an update below the minimum supported version', () async {
      when(() => repository.getMinimumSupportedVersion()).thenAnswer((_) async => '2.0.0');
      final info = await containerWith('1.4.2').read(forceUpdateProvider.future);
      expect(info!.isUpdateRequired, isTrue);
      expect(info.currentVersion, '1.4.2');
      expect(info.minimumVersion, '2.0.0');
    });

    test('no minimum version means no check', () async {
      when(() => repository.getMinimumSupportedVersion()).thenAnswer((_) async => null);
      expect(await containerWith('1.0.0').read(forceUpdateProvider.future), isNull);
    });
  });

  group('ForceUpdateGate', () {
    Future<void> pumpGate(WidgetTester tester, {required bool required}) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            fixedTranslationsOverride(),
            forceUpdateProvider.overrideWith(
              (ref) async => VersionInfo(currentVersion: required ? '1.0.0' : '2.0.0', minimumVersion: '2.0.0'),
            ),
          ],
          child: MaterialApp(
            builder: (context, child) => ForceUpdateGate(child: child!),
            home: Scaffold(body: TextButton(onPressed: () {}, child: const Text('Underneath'))),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('blocks the app with RN ForceUpdateModal copy when an update is required', (tester) async {
      await pumpGate(tester, required: true);

      expect(find.byType(ForceUpdateModal), findsOneWidget);
      expect(find.textContaining('Update', findRichText: true), findsWidgets);
      expect(find.textContaining('Alert!', findRichText: true), findsOneWidget);
      expect(find.text('A new version of Ally is available. Please update to continue using the app.'), findsOneWidget);
      expect(find.text('Update Now'), findsOneWidget);
      // No close affordance, and nothing underneath is reachable.
      expect(find.byIcon(Icons.close), findsNothing);
      expect(find.text('Underneath').hitTestable(), findsNothing);
    });

    testWidgets('stays out of the way when the build is current', (tester) async {
      await pumpGate(tester, required: false);

      expect(find.byType(ForceUpdateModal), findsNothing);
      expect(find.text('Underneath').hitTestable(), findsOneWidget);
    });
  });
}
