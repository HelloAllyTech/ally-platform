import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/deeplink/deep_link.dart';

/// Ports the cases of RN `utils/deeplink.ts` (`isSupportedDeepLink`,
/// `isCourseLink`, `getCourseIdFromUrl`, `getCallIdFromUrl`) and
/// RootNavigator's `handleURL` decision.
void main() {
  const web = 'https://app.helloally.ai/';
  const uuid = '3f2a6c1e-9b7d-4e2a-8c1f-0a1b2c3d4e5f';

  DeepLink? parse(String url) => parseDeepLink(Uri.parse(url), allyWebUrl: web);

  group('isSupportedDeepLink', () {
    bool supported(String url) => isSupportedDeepLink(Uri.parse(url), allyWebUrl: web);

    test('https on the web host under /summary or /course', () {
      expect(supported('https://app.helloally.ai/summary/12'), isTrue);
      expect(supported('https://app.helloally.ai/course/$uuid'), isTrue);
    });

    test('rejects other schemes, hosts, ports and paths', () {
      expect(supported('http://app.helloally.ai/summary/12'), isFalse);
      expect(supported('https://app.dev.helloally.ai/summary/12'), isFalse);
      expect(supported('https://evil.example/summary/12'), isFalse);
      expect(supported('https://app.helloally.ai:8443/summary/12'), isFalse);
      expect(supported('https://app.helloally.ai/scenario/12'), isFalse);
      expect(supported('https://app.helloally.ai/'), isFalse);
    });

    test('a prefix match counts, as RN startsWith does', () {
      expect(supported('https://app.helloally.ai/summaryx/12'), isTrue);
    });

    test('follows ALLY_WEB_URL (a dev web host)', () {
      expect(
        isSupportedDeepLink(Uri.parse('https://app.dev.helloally.ai/summary/1'), allyWebUrl: 'https://app.dev.helloally.ai/'),
        isTrue,
      );
    });
  });

  group('summary links', () {
    test('/summary/:id opens that call', () {
      expect(parse('https://app.helloally.ai/summary/12'), const SummaryDeepLink(12));
      expect(parse('https://app.helloally.ai/summary/12/'), const SummaryDeepLink(12));
      expect(parse('https://app.helloally.ai/summary/12?ref=mail'), const SummaryDeepLink(12));
    });

    test('Number() semantics: "7.0" parses; junk, encoded, 0 and fractions do not', () {
      expect(callIdFromUrl(Uri.parse('https://app.helloally.ai/summary/7.0')), 7);
      expect(callIdFromUrl(Uri.parse('https://app.helloally.ai/summary/%207')), isNull);
      expect(parse('https://app.helloally.ai/summary/abc'), isNull);
      expect(parse('https://app.helloally.ai/summary/0'), isNull);
      expect(parse('https://app.helloally.ai/summary/1.5'), isNull);
      expect(parse('https://app.helloally.ai/summary/Infinity'), isNull);
      expect(parse('https://app.helloally.ai/summary'), isNull);
    });
  });

  group('course links', () {
    test('/course/:uuid opens that course, case-insensitively', () {
      expect(parse('https://app.helloally.ai/course/$uuid'), const CourseDeepLink(uuid));
      expect(parse('https://app.helloally.ai/course/${uuid.toUpperCase()}'), CourseDeepLink(uuid.toUpperCase()));
    });

    test('a course link with a bad id is dropped, never read as a summary', () {
      expect(isCourseLink(Uri.parse('https://app.helloally.ai/course/42')), isTrue);
      expect(parse('https://app.helloally.ai/course/42'), isNull);
      expect(parse('https://app.helloally.ai/course'), isNull);
    });
  });
}
