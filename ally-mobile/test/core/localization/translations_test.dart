import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/localization/translations.dart';

void main() {
  group('Translations', () {
    final translations = Translations({
      'progress': {
        'title': 'Your progress',
        'hero': {'level': 'Level {{level}}'},
      },
    });

    test('resolves a nested dot-path key', () {
      expect(translations.t('progress.title'), 'Your progress');
    });

    test('interpolates {{var}} placeholders', () {
      expect(translations.t('progress.hero.level', {'level': 3}), 'Level 3');
    });

    test('falls back to the key itself when missing', () {
      expect(translations.t('does.not.exist'), 'does.not.exist');
    });

    test('mergedWith deep-merges, overlay wins on conflicts', () {
      final merged = translations.mergedWith({
        'progress': {'title': 'Overridden title'},
      });
      expect(merged.t('progress.title'), 'Overridden title');
      // Sibling key untouched by the overlay.
      expect(merged.t('progress.hero.level', {'level': 1}), 'Level 1');
    });

    group('plurals (i18next `t(key, {count})`)', () {
      Translations plural(String language) => Translations({
        'xp': {'total_one': '{{count}} XP point', 'total_other': '{{count}} XP points'},
        'exact': 'Exact {{count}}',
      }, language: language);

      test('picks _one / _other from count when the bare key is missing', () {
        expect(plural('en').t('xp.total', {'count': 1}), '1 XP point');
        expect(plural('en').t('xp.total', {'count': 5}), '5 XP points');
        expect(plural('en').t('xp.total', {'count': 0}), '0 XP points');
      });

      test('Hindi and Kannada treat 0 as one (CLDR), Marathi and Tamil do not', () {
        expect(plural('hi').t('xp.total', {'count': 0}), '0 XP point');
        expect(plural('kn').t('xp.total', {'count': 0}), '0 XP point');
        expect(plural('mr').t('xp.total', {'count': 0}), '0 XP points');
        expect(plural('ta').t('xp.total', {'count': 0}), '0 XP points');
      });

      test('an existing bare key wins, and a suffixed key still resolves directly', () {
        expect(plural('en').t('exact', {'count': 1}), 'Exact 1');
        expect(plural('en').t('xp.total_other', {'count': 1}), '1 XP points');
      });

      test('without a count the bare plural key is a visible miss', () {
        expect(plural('en').t('xp.total'), 'xp.total');
      });

      test('mergedWith keeps the language', () {
        expect(plural('hi').mergedWith({}).t('xp.total', {'count': 0}), '0 XP point');
      });
    });

    group('raw', () {
      final withStructuredContent = Translations({
        'terms': {
          'sections': [
            {
              'heading': 'General Terms',
              'content': ['Bullet one', 'Bullet two'],
            },
          ],
        },
      });

      test('returns a non-scalar node unconverted', () {
        final sections = withStructuredContent.raw('terms.sections');
        expect(sections, isA<List<dynamic>>());
        expect((sections as List)[0]['heading'], 'General Terms');
      });

      test('still resolves a scalar leaf, same as t() would', () {
        expect(translations.raw('progress.title'), 'Your progress');
      });

      test('returns null (not the key itself) when the path is missing', () {
        expect(translations.raw('does.not.exist'), isNull);
      });
    });
  });
}
