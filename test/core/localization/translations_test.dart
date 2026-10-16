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
