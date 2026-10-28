/// RN `constants/summary.ts` `formatDisplay` for the computed read-only
/// fields, and `utils/customFieldDate.ts` for DATE custom fields.
library;

typedef Translate = String Function(String key);

String _pad(int n) => n.toString().padLeft(2, '0');

/// RN `formatDurationFromSeconds(value, {includeSeconds: false, format:
/// 'long'})`: "1 hour 5 minutes", "0 minutes"; '-' when not a number.
String formatSummaryCallDuration(Object? value, Translate t) {
  final total = value is num ? value.toInt() : int.tryParse('${value ?? ''}');
  if (total == null || total < 0) return '-';
  final days = total ~/ 86400;
  final hours = (total % 86400) ~/ 3600;
  final minutes = (total % 3600) ~/ 60;
  String unit(int n, String name) => t(n == 1 ? 'summary.duration.$name' : 'summary.duration.${name}s');
  final parts = [
    if (days > 0) '$days ${unit(days, 'day')}',
    if (hours > 0) '$hours ${unit(hours, 'hour')}',
    if (minutes > 0) '$minutes ${unit(minutes, 'minute')}',
  ];
  return parts.isEmpty ? '0 minutes' : parts.join(' ');
}

/// RN `formatDateWithOrdinal`: "5th March 2026" (no suffix outside English;
/// month names from `months.full`).
String formatSummaryCallDate(Object? value, {required List<String> months, required bool isEnglish}) {
  if (value is! String || value.isEmpty) return '-';
  final date = DateTime.tryParse(value)?.toLocal();
  if (date == null) return '-';
  final day = date.day;
  final suffix = !isEnglish
      ? ''
      : (day > 3 && day < 21)
      ? 'th'
      : switch (day % 10) {
          1 => 'st',
          2 => 'nd',
          3 => 'rd',
          _ => 'th',
        };
  return '$day$suffix ${months[date.month - 1]} ${date.year}';
}

/// RN `formatTimeRange`: "HH:mm-HH:mm" (24h, local) or '-'.
String formatSummaryCallTime(String? start, String? end) {
  final s = DateTime.tryParse(start ?? '')?.toLocal();
  final e = DateTime.tryParse(end ?? '')?.toLocal();
  if (s == null || e == null) return '-';
  return '${_pad(s.hour)}:${_pad(s.minute)}-${_pad(e.hour)}:${_pad(e.minute)}';
}

/// RN `normalizeCustomFieldDate`: a stored DATE value as YYYY-MM-DD — kept
/// when already date-only, otherwise parsed and read in the org's IST
/// (+5:30) day; null when empty or unparseable.
String? normalizeCustomFieldDate(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(trimmed)) return trimmed;
  final parsed = DateTime.tryParse(trimmed);
  if (parsed == null) return null;
  final shifted = parsed.toUtc().add(const Duration(minutes: 330));
  return '${shifted.year}-${_pad(shifted.month)}-${_pad(shifted.day)}';
}

/// RN `formatCustomFieldDate`.
String formatCustomFieldDate(String? value) => normalizeCustomFieldDate(value) ?? (value?.trim() ?? '-');
