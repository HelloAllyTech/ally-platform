import 'dart:convert';

import 'custom_fields_repository.dart';

/// Custom-field half of ally-mobile (React Native)'s `VoiceNoteSection`
/// (`screens/CallSummaryScreen/components/VoiceNotePanel/VoiceNoteSection.tsx`):
/// which of the org's custom fields dictation may fill, how each is
/// described to `POST /chats/note/generate-from-audio`, and how the model's
/// spoken answer is encoded the way the custom-field editors store it.

/// RN's `canEdit` filter in the `voiceFields` memo (note: counsellor-only
/// fields go by the COUNSELOR_ACCESS permission here, not by call ownership).
bool canVoiceFillCustomField(
  CustomFieldDefinition def, {
  required bool isAdmin,
  required bool isCounsellor,
}) =>
    switch (def.editPermission) {
      CustomFieldEditPermission.both => true,
      CustomFieldEditPermission.adminOnly => isAdmin,
      CustomFieldEditPermission.counsellorOnly => isCounsellor,
    };

/// RN `mapCustomType`.
String _voiceType(CustomFieldType type) => switch (type) {
      CustomFieldType.singleSelect => 'select',
      CustomFieldType.multiSelect => 'multiselect',
      CustomFieldType.number => 'number',
      CustomFieldType.boolean => 'boolean',
      CustomFieldType.date => 'date',
      CustomFieldType.text => 'text',
    };

/// The `fields` entry RN sends for a custom field: `{id, label, type,
/// options?}`; a boolean offers `Yes`/`No`.
Map<String, dynamic> voiceCustomFieldSpec(CustomFieldDefinition def) {
  final options = def.fieldType == CustomFieldType.boolean
      ? const ['Yes', 'No']
      : (def.options?.isNotEmpty ?? false)
          ? [for (final o in def.options!) o.label]
          : null;
  return {
    'id': def.id,
    'label': def.name,
    'type': _voiceType(def.fieldType),
    'options': ?options,
  };
}

/// RN `encodeVoiceCustomValue`: single-select → the canonical option label,
/// multi-select → JSON array of labels, boolean → "true"/"false", date →
/// `YYYY-MM-DD`. Null when the value can't be mapped (an option that no
/// longer exists, an unparseable date), so nothing invalid is written.
String? encodeVoiceCustomValue(CustomFieldDefinition def, String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  switch (def.fieldType) {
    case CustomFieldType.singleSelect:
      for (final o in def.options ?? const <CustomFieldOption>[]) {
        if (o.label.toLowerCase() == trimmed.toLowerCase()) return o.label;
      }
      return null;
    case CustomFieldType.multiSelect:
      // The backend sends matched labels as a JSON array (comma-safe); fall
      // back to comma-splitting if it isn't valid JSON.
      List<String> labels;
      try {
        final parsed = jsonDecode(trimmed);
        labels = parsed is List ? parsed.map((e) => '$e').toList() : [trimmed];
      } catch (_) {
        labels = trimmed.split(',');
      }
      final wanted = labels.map((s) => s.trim().toLowerCase()).where((s) => s.isNotEmpty).toSet();
      final matched = [
        for (final o in def.options ?? const <CustomFieldOption>[])
          if (wanted.contains(o.label.toLowerCase())) o.label,
      ];
      return matched.isEmpty ? null : jsonEncode(matched);
    case CustomFieldType.boolean:
      final v = trimmed.toLowerCase();
      if (const ['yes', 'true', 'y'].contains(v)) return 'true';
      if (const ['no', 'false', 'n'].contains(v)) return 'false';
      return null;
    case CustomFieldType.date:
      return spokenDateToCustomFieldDate(trimmed);
    case CustomFieldType.number:
    case CustomFieldType.text:
      return trimmed;
  }
}

const _months = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
  'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
};

String _pad(int n) => n.toString().padLeft(2, '0');

/// RN `utils/customFieldDate.ts` `spokenDateToCustomFieldDate`: a calendar
/// date as `YYYY-MM-DD`, read from the date's LOCAL fields (never via UTC,
/// which rolled the day back in IST). A bare `YYYY-MM-DD` passes through;
/// an ISO instant and the prose forms the model speaks ("22 August 2026",
/// "August 22, 2026") are parsed; anything else is null.
String? spokenDateToCustomFieldDate(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(trimmed)) return trimmed;

  final iso = DateTime.tryParse(trimmed);
  if (iso != null) {
    final local = iso.toLocal();
    return '${local.year}-${_pad(local.month)}-${_pad(local.day)}';
  }

  String? build(String day, String month, String year) {
    final m = _months[month.toLowerCase().substring(0, 3)];
    final d = int.tryParse(day);
    final y = int.tryParse(year);
    if (m == null || d == null || y == null) return null;
    final date = DateTime(y, m, d);
    if (date.month != m || date.day != d) return null; // e.g. 31 Feb
    return '$y-${_pad(m)}-${_pad(d)}';
  }

  final dayFirst = RegExp(r'^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,})\.?,?\s+(\d{4})$').firstMatch(trimmed);
  if (dayFirst != null) return build(dayFirst[1]!, dayFirst[2]!, dayFirst[3]!);
  final monthFirst = RegExp(r'^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$').firstMatch(trimmed);
  if (monthFirst != null) return build(monthFirst[2]!, monthFirst[1]!, monthFirst[3]!);
  return null;
}
