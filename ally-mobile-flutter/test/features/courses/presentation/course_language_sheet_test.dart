import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/presentation/course_language_sheet.dart';

void main() {
  group('getCourseLanguageLabel', () {
    test('returns the app endonym for each of the 5 supported languages', () {
      expect(getCourseLanguageLabel('en'), 'English');
      expect(getCourseLanguageLabel('hi'), 'हिंदी');
      expect(getCourseLanguageLabel('mr'), 'मराठी');
      expect(getCourseLanguageLabel('ta'), 'தமிழ்');
      expect(getCourseLanguageLabel('kn'), 'ಕನ್ನಡ');
    });

    test('falls back to English for a code outside the app\'s 5 languages', () {
      expect(getCourseLanguageLabel('fr'), 'English');
      expect(getCourseLanguageLabel(''), 'English');
    });
  });
}
