import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/calllog/data/summary_display_format.dart';

String _t(String key) => key.split('.').last;

const _months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

void main() {
  test('call duration: RN long format without seconds', () {
    expect(formatSummaryCallDuration(3900, _t), '1 hour 5 minutes');
    expect(formatSummaryCallDuration('754', _t), '12 minutes');
    expect(formatSummaryCallDuration(30, _t), '0 minutes');
    expect(formatSummaryCallDuration(null, _t), '-');
  });

  test('call date: ordinal only in English', () {
    final local = DateTime(2026, 3, 22, 12).toUtc().toIso8601String();
    expect(formatSummaryCallDate(local, months: _months, isEnglish: true), '22nd March 2026');
    expect(formatSummaryCallDate(local, months: _months, isEnglish: false), '22 March 2026');
    expect(formatSummaryCallDate(null, months: _months, isEnglish: true), '-');
  });

  test('call time: HH:mm-HH:mm', () {
    final start = DateTime(2026, 1, 1, 9, 5).toUtc().toIso8601String();
    final end = DateTime(2026, 1, 1, 21, 40).toUtc().toIso8601String();
    expect(formatSummaryCallTime(start, end), '09:05-21:40');
    expect(formatSummaryCallTime(start, null), '-');
  });

  test('custom DATE values normalise to the IST day', () {
    expect(normalizeCustomFieldDate('2026-02-03'), '2026-02-03');
    // 20:00Z is already the next day in IST.
    expect(normalizeCustomFieldDate('2026-02-03T20:00:00.000Z'), '2026-02-04');
    expect(normalizeCustomFieldDate('  '), isNull);
    expect(formatCustomFieldDate('not a date'), 'not a date');
  });
}
