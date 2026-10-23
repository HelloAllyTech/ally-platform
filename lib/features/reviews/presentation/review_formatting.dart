import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/localization/translate_ref.dart';

/// Ports of ally-mobile (React Native)'s `src/utils/date.ts` formatters used
/// by `ReviewCard` — exact thresholds/formats, not approximations.
///
/// `ref.t()` has no built-in ICU plural support (unlike i18next's `t(key,
/// {count})` on the RN side, which resolves `_one`/`_other` keys
/// automatically) — [_plural] below picks the right suffix manually and
/// interpolates `count` itself.
String _plural(WidgetRef ref, String baseKey, int count) =>
    ref.t('$baseKey${count == 1 ? '_one' : '_other'}', {'count': count});

/// "February 18, 2025 11:05 AM" — RN's `formatDateTime`.
String formatReviewDateTime(String iso) {
  final date = DateTime.parse(iso).toLocal();
  return DateFormat('MMMM d, yyyy h:mm a').format(date);
}

const _secondsInYear = 365 * 24 * 60 * 60;
const _secondsInMonth = 30 * 24 * 60 * 60;
const _secondsInWeek = 7 * 24 * 60 * 60;
const _secondsInDay = 24 * 60 * 60;
const _secondsInHour = 60 * 60;
const _secondsInMinute = 60;

/// "1 year ago"-style relative time — RN's `formatRelativeTime`, minus the
/// "ago" suffix (not part of the translated unit strings themselves; RN
/// doesn't append one either, see the real component's rendered output).
String formatReviewRelativeTime(WidgetRef ref, String iso) {
  final diffSeconds = DateTime.now().difference(DateTime.parse(iso).toLocal()).inSeconds;
  const prefix = 'review.feedCard.relativeTime';
  final justNow = ref.t('$prefix.justNow');
  if (diffSeconds < 1) return justNow;

  final years = diffSeconds ~/ _secondsInYear;
  if (years >= 2) return _plural(ref, '$prefix.year', years);
  if (years == 1) {
    final months = (diffSeconds % _secondsInYear) ~/ _secondsInMonth;
    if (months == 0) return _plural(ref, '$prefix.year', 1);
    return ref.t('$prefix.yearMonth', {'months': _plural(ref, '$prefix.month', months)});
  }

  final thresholds = [
    ('$prefix.month', _secondsInMonth),
    ('$prefix.week', _secondsInWeek),
    ('$prefix.day', _secondsInDay),
    ('$prefix.hour', _secondsInHour),
    ('$prefix.minute', _secondsInMinute),
    ('$prefix.second', 1),
  ];
  for (final (key, secondsPerUnit) in thresholds) {
    final value = diffSeconds ~/ secondsPerUnit;
    if (value >= 1) return _plural(ref, key, value);
  }
  return justNow;
}

/// RN's `formatDurationFromSeconds`, short format only (the only format
/// `ReviewCard` ever uses): "1d 2h 30m", "1:30:00 hr", "4:37 min", "12 sec".
String formatReviewDuration(String? secondsValue) {
  if (secondsValue == null) return '-';
  final totalSeconds = int.tryParse(secondsValue);
  if (totalSeconds == null || totalSeconds < 0) return '-';

  final days = totalSeconds ~/ 86400;
  final hours = (totalSeconds % 86400) ~/ 3600;
  final minutes = (totalSeconds % 3600) ~/ 60;
  final seconds = totalSeconds % 60;

  if (days > 0) return '${days}d ${hours}h ${minutes}m';
  if (hours > 0) {
    return '$hours:${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')} hr';
  }
  if (minutes > 0) return '$minutes:${seconds.toString().padLeft(2, '0')} min';
  return '$seconds sec';
}

/// RN's `htmlToPlainText` — strips tags/scripts/styles and collapses
/// whitespace, close enough for a one-paragraph scenario description
/// (not a full HTML entity-decoding pass, which this app's scenario
/// descriptions don't need in practice).
String htmlToPlainText(String? value) {
  if (value == null || value.isEmpty) return '';
  final stripped = value
      .replaceAll(RegExp(r'<script[\s\S]*?</script>', caseSensitive: false), ' ')
      .replaceAll(RegExp(r'<style[\s\S]*?</style>', caseSensitive: false), ' ')
      .replaceAll(RegExp('<[^>]*>'), ' ');
  return stripped.replaceAll(RegExp(r'\s+'), ' ').trim();
}
