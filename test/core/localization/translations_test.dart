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
  });
}
