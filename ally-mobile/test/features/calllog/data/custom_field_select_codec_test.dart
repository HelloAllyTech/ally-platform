import 'dart:convert';

import 'package:ally_mobile_flutter/features/calllog/data/custom_field_select_codec.dart';
import 'package:ally_mobile_flutter/features/calllog/data/custom_fields_repository.dart';
import 'package:flutter_test/flutter_test.dart';

CustomFieldDefinition _def(CustomFieldType type) => CustomFieldDefinition(
      id: 'cf-1',
      name: 'Ongoing risks',
      fieldType: type,
      sectionKey: 'risk',
      editPermission: CustomFieldEditPermission.values.first,
      options: const [
        CustomFieldOption(id: 'uuid-run', label: 'Running away', order: 0),
        CustomFieldOption(id: 'uuid-harm', label: 'Self harm', order: 1),
      ],
    );

void main() {
  final single = _def(CustomFieldType.singleSelect);
  final multi = _def(CustomFieldType.multiSelect);

  test('a single pick is sent as its option id', () {
    expect(selectValueToWire(single, 'Running away'), 'uuid-run');
    expect(selectValueToWire(single, 'running away '), 'uuid-run');
    // Already an id (from the web): unchanged.
    expect(selectValueToWire(single, 'uuid-run'), 'uuid-run');
  });

  test('a single value loads as its label, whichever form was stored', () {
    expect(selectValueFromWire(single, 'uuid-harm'), 'Self harm');
    expect(selectValueFromWire(single, 'Self harm'), 'Self harm');
  });

  test('multi picks round-trip through ids', () {
    final wire = selectValueToWire(multi, jsonEncode(['Self harm', 'Running away']));
    expect(jsonDecode(wire!), ['uuid-harm', 'uuid-run']);
    expect(jsonDecode(selectValueFromWire(multi, wire)!), ['Self harm', 'Running away']);
  });

  test('old and odd values are never lost', () {
    // A bare label from an old build, and a value matching no option.
    expect(jsonDecode(selectValueFromWire(multi, 'Running away')!), ['Running away']);
    expect(selectValueToWire(single, 'Retired option'), 'Retired option');
    expect(selectValueToWire(single, null), isNull);
    expect(selectValueToWire(single, ''), '');
  });

  test('other field types pass through', () {
    final text = _def(CustomFieldType.text);
    expect(selectValueToWire(text, 'Running away'), 'Running away');
    expect(selectValueFromWire(text, 'uuid-run'), 'uuid-run');
  });
}
