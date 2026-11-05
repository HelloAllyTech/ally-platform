import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/review_formatting.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

void main() {
  test('formatReviewDuration: short format matches RN exactly for each magnitude', () {
    expect(formatReviewDuration(null), '-');
    expect(formatReviewDuration('not-a-number'), '-');
    expect(formatReviewDuration('-5'), '-');
    expect(formatReviewDuration('45'), '45 sec');
    expect(formatReviewDuration('90'), '1:30 min');
    expect(formatReviewDuration('277'), '4:37 min');
    expect(formatReviewDuration('3665'), '1:01:05 hr');
    expect(formatReviewDuration('93780'), '1d 2h 3m');
  });

  test('formatReviewDateTime matches RN\'s "Month d, yyyy h:mm a" format', () {
    expect(formatReviewDateTime('2025-02-18T11:05:00'), 'February 18, 2025 11:05 AM');
  });

  // `formatReviewRelativeTime` takes a `WidgetRef` to resolve translations
  // through `ref.t()`, which can only legally be called mid-`build()` (a
  // `ref` captured and reused later triggers a provider "used outside of
  // build" miss, which is what previously made every case in this group
  // silently fall back to the raw key instead of throwing). `_Harness`
  // below calls the function *inside* `build()` and renders the result as
  // text, so every case here reads it back via `find.text(...)` instead of
  // calling the function directly from the test body.
  String iso(Duration agoDuration) =>
      DateTime.now().toUtc().subtract(agoDuration).toIso8601String();

  Future<void> pumpRelative(WidgetTester tester, String isoString) => pumpApp(
    tester,
    _Harness(iso: isoString),
    overrides: [fixedTranslationsOverride()],
  );

  group('formatReviewRelativeTime', () {
    testWidgets('just now, for a timestamp less than a second old', (tester) async {
      await pumpRelative(tester, DateTime.now().toUtc().toIso8601String());
      expect(find.text('Just now'), findsOneWidget);
    });

    testWidgets('minutes/hours/days/weeks/months pick the largest whole unit', (tester) async {
      await pumpRelative(tester, iso(const Duration(minutes: 5)));
      expect(find.text('5 minutes'), findsOneWidget);

      await pumpRelative(tester, iso(const Duration(hours: 3)));
      expect(find.text('3 hours'), findsOneWidget);

      await pumpRelative(tester, iso(const Duration(days: 2)));
      expect(find.text('2 Days'), findsOneWidget);

      await pumpRelative(tester, iso(const Duration(days: 14)));
      expect(find.text('2 weeks'), findsOneWidget);

      await pumpRelative(tester, iso(const Duration(days: 60)));
      expect(find.text('2 months'), findsOneWidget);
    });

    testWidgets('singular units use the _one key, not _other', (tester) async {
      await pumpRelative(tester, iso(const Duration(minutes: 1)));
      expect(find.text('1 minute'), findsOneWidget);
    });

    testWidgets('a full year with no extra months just says "1 year"', (tester) async {
      await pumpRelative(tester, iso(const Duration(days: 365)));
      expect(find.text('1 year'), findsOneWidget);
    });

    testWidgets('two or more years ignores months entirely', (tester) async {
      await pumpRelative(tester, iso(const Duration(days: 365 * 2 + 40)));
      expect(find.text('2 years'), findsOneWidget);
    });
  });
}

class _Harness extends ConsumerWidget {
  const _Harness({required this.iso});

  final String iso;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Text(formatReviewRelativeTime(ref, iso));
  }
}
