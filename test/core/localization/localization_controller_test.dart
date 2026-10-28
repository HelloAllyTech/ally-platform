import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/config/app_config.dart';
import 'package:ally_mobile_flutter/core/localization/localization_controller.dart';
import 'package:ally_mobile_flutter/core/localization/translations.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

// NOTE on what's intentionally NOT covered here: `AppConfig.languageSelectorEnabled`
// is a `bool.fromEnvironment` compile-time constant, so a plain `flutter test`
// run (no --dart-define) always sees it as false. That means build()'s
// WidgetsBindingObserver registration, the 30s Timer.periodic poll, and the
// automatic fire-and-forget `refresh()` call on first build are never
// exercised by this suite — they're unreachable without a differently-defined
// test binary. `refresh()`/`_refresh()` themselves are still fully testable
// by calling them directly on the notifier, which is what the tests below do.
void main() {
  group('bundled asset loading', () {
    testWidgets('loads the bundled en translations when no language is stored', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer();
      addTearDown(container.dispose);

      late Translations translations;
      await tester.runAsync(() async {
        translations = await container.read(localizationControllerProvider.future);
      });

      expect(translations.t('progress.title'), 'Your progress');
    });

    testWidgets('restores a previously selected language from SharedPreferences', (tester) async {
      SharedPreferences.setMockInitialValues({'ui_language': 'hi'});
      final container = ProviderContainer();
      addTearDown(container.dispose);

      late Translations translations;
      await tester.runAsync(() async {
        translations = await container.read(localizationControllerProvider.future);
      });

      expect(translations.t('progress.title'), 'आपकी प्रगति');
      // Plural keys resolve from `count` in the stored language.
      expect(translations.t('progress.hero.xpTotal', {'count': 5}), 'कुल 5 XP अर्जित');
    });
  });

  group('changeLanguage', () {
    testWidgets('switches to a supported language and persists the choice', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer();
      addTearDown(container.dispose);

      await tester.runAsync(() async {
        await container.read(localizationControllerProvider.future);
        await container.read(localizationControllerProvider.notifier).changeLanguage('mr');
      });

      final translations = container.read(localizationControllerProvider).value!;
      expect(translations.t('progress.title'), 'तुमची प्रगती');

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('ui_language'), 'mr');
    });

    testWidgets('ignores an unsupported language code', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer();
      addTearDown(container.dispose);

      await tester.runAsync(() async {
        await container.read(localizationControllerProvider.future);
        await container.read(localizationControllerProvider.notifier).changeLanguage('fr');
      });

      final translations = container.read(localizationControllerProvider).value!;
      expect(translations.t('progress.title'), 'Your progress');

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('ui_language'), isNull);
    });
  });

  group('refresh (CDN sync)', () {
    testWidgets(
      'fetches the manifest and every namespace, merging the result over the bundled translations',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final dio = MockDio();
        when(() => dio.get<Map<String, dynamic>>('${AppConfig.i18nBaseUrl}/manifest.json'))
            .thenAnswer(
          (_) async => _response({
            'currentVersion': 'v2',
            'languages': ['en', 'hi'],
            'namespaces': ['progress'],
          }),
        );
        when(
          () => dio.get<Map<String, dynamic>>('${AppConfig.i18nBaseUrl}/v2/en/progress.json'),
        ).thenAnswer((_) async => _response({'title': 'CDN progress title'}));

        final container = ProviderContainer(
          overrides: [localizationControllerProvider.overrideWith(() => LocalizationController(dio: dio))],
        );
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          await container.read(localizationControllerProvider.future);
          await container.read(localizationControllerProvider.notifier).refresh();
        });

        final translations = container.read(localizationControllerProvider).value!;
        // Overridden by the CDN namespace...
        expect(translations.t('progress.title'), 'CDN progress title');
        // ...but a sibling bundled key the CDN response didn't touch survives
        // the merge, same as Translations.mergedWith's own contract.
        expect(translations.t('progress.hero.level', {'level': 3}), 'Level 3');

        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('i18n_version'), 'v2');
      },
    );

    testWidgets(
      'short-circuits when the cached version already matches the manifest (no namespace fetch)',
      (tester) async {
        SharedPreferences.setMockInitialValues({
          'i18n_version': 'v2',
          'i18n_resource_v2_en': jsonEncode({
            'progress': {'title': 'Already cached title'},
          }),
        });
        final dio = MockDio();
        when(() => dio.get<Map<String, dynamic>>('${AppConfig.i18nBaseUrl}/manifest.json'))
            .thenAnswer(
          (_) async => _response({
            'currentVersion': 'v2',
            'languages': ['en'],
            'namespaces': ['progress'],
          }),
        );

        final container = ProviderContainer(
          overrides: [localizationControllerProvider.overrideWith(() => LocalizationController(dio: dio))],
        );
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          // build() itself applies the already-cached v2 resource.
          await container.read(localizationControllerProvider.future);
          await container.read(localizationControllerProvider.notifier).refresh();
        });

        verifyNever(
          () => dio.get<Map<String, dynamic>>('${AppConfig.i18nBaseUrl}/v2/en/progress.json'),
        );
        final translations = container.read(localizationControllerProvider).value!;
        expect(translations.t('progress.title'), 'Already cached title');
      },
    );

    testWidgets(
      'same version but nothing cached for the current language: fetches it (RN cachedResource check)',
      (tester) async {
        SharedPreferences.setMockInitialValues({
          'ui_language': 'hi',
          'i18n_version': 'v2',
          // Only English was ever synced for v2.
          'i18n_resource_v2_en': jsonEncode({
            'progress': {'title': 'EN cached'},
          }),
        });
        final dio = MockDio();
        when(() => dio.get<Map<String, dynamic>>('${AppConfig.i18nBaseUrl}/manifest.json')).thenAnswer(
          (_) async => _response({
            'currentVersion': 'v2',
            'languages': ['en', 'hi'],
            'namespaces': ['progress'],
          }),
        );
        when(() => dio.get<Map<String, dynamic>>('${AppConfig.i18nBaseUrl}/v2/hi/progress.json'))
            .thenAnswer((_) async => _response({'title': 'HI from CDN'}));

        final container = ProviderContainer(
          overrides: [localizationControllerProvider.overrideWith(() => LocalizationController(dio: dio))],
        );
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          await container.read(localizationControllerProvider.future);
          await container.read(localizationControllerProvider.notifier).refresh();
        });

        expect(container.read(localizationControllerProvider).value!.t('progress.title'), 'HI from CDN');
      },
    );

    testWidgets(
      'swallows a network error and leaves the existing translations untouched',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final dio = MockDio();
        when(() => dio.get<Map<String, dynamic>>('${AppConfig.i18nBaseUrl}/manifest.json'))
            .thenThrow(DioException(requestOptions: RequestOptions(path: '')));

        final container = ProviderContainer(
          overrides: [localizationControllerProvider.overrideWith(() => LocalizationController(dio: dio))],
        );
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          await container.read(localizationControllerProvider.future);
          // Should not throw out of refresh() despite the mocked network
          // failure above.
          await container.read(localizationControllerProvider.notifier).refresh();
        });

        final translations = container.read(localizationControllerProvider).value!;
        expect(translations.t('progress.title'), 'Your progress');
      },
    );
  });
}
