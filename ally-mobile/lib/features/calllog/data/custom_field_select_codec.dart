import 'dart:convert';

import 'custom_fields_repository.dart';

/// Select values on the wire vs on this screen.
///
/// The web app and the server's own filters store a SINGLE_SELECT value as
/// the option's *id* and a MULTI_SELECT value as a JSON array of ids. This
/// app's form works in *labels* (ported from RN, which saved labels), so a
/// pick made here on an admin-created field — whose option ids are uuids, not
/// the label — showed as "—" on the web and never matched a filter. Seeded
/// fields were unaffected only because their ids equal their labels.
///
/// The form keeps working in labels; these two functions convert at the
/// boundary. Both accept either form, so values written by older builds
/// (labels) and by the web (ids) load the same way, and anything that
/// matches no option passes through untouched rather than being lost.

String? _matchOption(CustomFieldDefinition def, String raw, {required bool toId}) {
  final options = def.options ?? const <CustomFieldOption>[];
  for (final o in options) {
    if (o.id == raw) return toId ? o.id : o.label;
  }
  final lowered = raw.trim().toLowerCase();
  for (final o in options) {
    if (o.label.trim().toLowerCase() == lowered) return toId ? o.id : o.label;
  }
  return null;
}

List<String> _items(String value) {
  try {
    final decoded = jsonDecode(value);
    if (decoded is List) return decoded.map((e) => '$e').toList();
  } catch (_) {}
  return [value];
}

String? _convert(CustomFieldDefinition def, String? value, {required bool toId}) {
  if (value == null || value.isEmpty) return value;
  switch (def.fieldType) {
    case CustomFieldType.singleSelect:
      return _matchOption(def, value, toId: toId) ?? value;
    case CustomFieldType.multiSelect:
      final converted = [
        for (final item in _items(value)) _matchOption(def, item, toId: toId) ?? item,
      ];
      return jsonEncode(converted);
    default:
      return value;
  }
}

/// The value to send to the server: option ids for select fields.
String? selectValueToWire(CustomFieldDefinition def, String? value) => _convert(def, value, toId: true);

/// The value this form works with: option labels for select fields.
String? selectValueFromWire(CustomFieldDefinition def, String? value) => _convert(def, value, toId: false);
