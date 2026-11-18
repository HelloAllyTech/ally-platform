/// Pure port of ally-mobile (React Native)'s
/// `src/screens/CallLog/utils/fieldFilters.ts` — the custom-field half only;
/// this app's built-in filters (date/duration/mode/status/channel/tags) are
/// already hand-built in `call_log_filter_sheet.dart`/`CallLogFilterState`,
/// unlike RN's single data-driven `getFilterFields` that merges both. Kept
/// as pure, directly-testable functions, same precedent as
/// `active_chat_discovery.dart`/`notification_navigation.dart`.
library;

import 'dart:convert';

import 'custom_fields_repository.dart';

/// RN's `FilterControl` — the kind of input control a field filters with.
enum FilterControl { multiselect, text, number, date }

/// RN's `controlForFieldType`.
FilterControl controlForFieldType(CustomFieldType fieldType) {
  switch (fieldType) {
    case CustomFieldType.singleSelect:
    case CustomFieldType.multiSelect:
    case CustomFieldType.boolean:
      return FilterControl.multiselect;
    case CustomFieldType.number:
      return FilterControl.number;
    case CustomFieldType.date:
      return FilterControl.date;
    case CustomFieldType.text:
      return FilterControl.text;
  }
}

/// RN's `optionsForDef` — options are keyed by the field definition's option
/// *id* here (unlike `CustomFieldsSection`'s edit flow, which stores the
/// option *label* on the summary itself — a real, confirmed RN quirk, not a
/// mistake introduced here). A BOOLEAN field's two options are synthesized.
List<({String label, String value})> optionsForDef(CustomFieldDefinition def) {
  if (def.fieldType == CustomFieldType.boolean) {
    return const [(label: 'Yes', value: 'true'), (label: 'No', value: 'false')];
  }
  return [for (final o in def.sortedOptions) (label: o.label, value: o.id)];
}

/// One filterable custom field, ready for the filter sheet to render.
class CustomFieldFilterDef {
  const CustomFieldFilterDef({
    required this.id,
    required this.label,
    required this.control,
    required this.options,
  });

  final String id;
  final String label;
  final FilterControl control;
  final List<({String label, String value})> options;
}

/// RN's `filterableDefs` — a definition is filterable unless explicitly
/// marked otherwise (already defaulted to `true` in
/// [CustomFieldDefinition.filterable] when absent from the JSON).
List<CustomFieldDefinition> filterableDefs(List<CustomFieldDefinition> defs) =>
    defs.where((d) => d.filterable).toList();

/// RN's custom-field half of `getFilterFields`.
List<CustomFieldFilterDef> customFieldFilterDefs(List<CustomFieldDefinition> defs) => [
  for (final def in filterableDefs(defs))
    CustomFieldFilterDef(id: def.id, label: def.name, control: controlForFieldType(def.fieldType), options: optionsForDef(def)),
];

/// A filter value: either a plain string (TEXT) or a list of strings
/// (multiselect option ids, or a 2-element [from, to] / [min, max] range —
/// RN's `FilterValue = string | string[]`, represented here as `Object` for
/// the same reason RN uses a union: the two controls share one map.
typedef CustomFieldFilterValue = Object;

/// RN's `hasValue`.
bool hasFilterValue(CustomFieldFilterValue? value) {
  if (value == null) return false;
  if (value is List) return value.any((v) => v is String && v.trim().isNotEmpty);
  if (value is String) return value.trim().isNotEmpty;
  return false;
}

/// RN's `buildFieldFiltersParam` — serialises non-empty custom-field entries
/// into the `fieldFilters` query param's JSON shape
/// (`[{fieldDefinitionId, value}, ...]`), or `null` when none are set.
String? buildFieldFiltersParam(Map<String, CustomFieldFilterValue> customFieldValues) {
  final entries = [
    for (final entry in customFieldValues.entries)
      if (hasFilterValue(entry.value)) {'fieldDefinitionId': entry.key, 'value': entry.value},
  ];
  return entries.isEmpty ? null : jsonEncode(entries);
}
