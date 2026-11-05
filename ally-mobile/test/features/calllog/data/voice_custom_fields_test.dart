import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/calllog/data/custom_fields_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/data/voice_custom_fields.dart';

CustomFieldDefinition _def(
  CustomFieldType type, {
  List<String> options = const [],
  CustomFieldEditPermission permission = CustomFieldEditPermission.both,
}) =>
    CustomFieldDefinition.fromJson({
      'id': 'f1',
      'name': 'Field',
      'fieldType': type.wireValue,
      'sectionKey': 'keyConcern',
      'editPermission': permission.wireValue,
      'options': [
        for (final (i, o) in options.indexed) {'id': 'o$i', 'label': o, 'order': i},
      ],
    });

void main() {
  group('encodeVoiceCustomValue (RN VoiceNoteSection)', () {
    test('single select matches an option label case-insensitively', () {
      final def = _def(CustomFieldType.singleSelect, options: ['Low', 'High']);
      expect(encodeVoiceCustomValue(def, ' high '), 'High');
      expect(encodeVoiceCustomValue(def, 'medium'), isNull);
    });

    test('multi select: JSON or comma list in, JSON array of known labels out', () {
      final def = _def(CustomFieldType.multiSelect, options: ['Sleep', 'Work', 'Family']);
      expect(encodeVoiceCustomValue(def, '["work","family"]'), '["Work","Family"]');
      expect(encodeVoiceCustomValue(def, 'sleep, unknown'), '["Sleep"]');
      expect(encodeVoiceCustomValue(def, 'nothing'), isNull);
    });

    test('boolean', () {
      final def = _def(CustomFieldType.boolean);
      expect(encodeVoiceCustomValue(def, 'Yes'), 'true');
      expect(encodeVoiceCustomValue(def, 'n'), 'false');
      expect(encodeVoiceCustomValue(def, 'maybe'), isNull);
    });

    test('date is a calendar day, never shifted through UTC', () {
      final def = _def(CustomFieldType.date);
      expect(encodeVoiceCustomValue(def, '2026-08-22'), '2026-08-22');
      expect(encodeVoiceCustomValue(def, '22 August 2026'), '2026-08-22');
      expect(encodeVoiceCustomValue(def, 'August 22, 2026'), '2026-08-22');
      expect(encodeVoiceCustomValue(def, '31 February 2026'), isNull);
      expect(encodeVoiceCustomValue(def, 'next week'), isNull);
    });

    test('text and number pass through trimmed', () {
      expect(encodeVoiceCustomValue(_def(CustomFieldType.text), ' hi '), 'hi');
      expect(encodeVoiceCustomValue(_def(CustomFieldType.number), '42'), '42');
      expect(encodeVoiceCustomValue(_def(CustomFieldType.text), '  '), isNull);
    });
  });

  test('field spec: type mapping and Yes/No for booleans', () {
    expect(voiceCustomFieldSpec(_def(CustomFieldType.boolean)), {
      'id': 'f1',
      'label': 'Field',
      'type': 'boolean',
      'options': ['Yes', 'No'],
    });
    expect(voiceCustomFieldSpec(_def(CustomFieldType.multiSelect, options: ['A']))['type'], 'multiselect');
    expect(voiceCustomFieldSpec(_def(CustomFieldType.text)).containsKey('options'), isFalse);
  });

  test('edit permission gate', () {
    final adminOnly = _def(CustomFieldType.text, permission: CustomFieldEditPermission.adminOnly);
    final counsellorOnly = _def(CustomFieldType.text, permission: CustomFieldEditPermission.counsellorOnly);
    expect(canVoiceFillCustomField(adminOnly, isAdmin: false, isCounsellor: true), isFalse);
    expect(canVoiceFillCustomField(adminOnly, isAdmin: true, isCounsellor: false), isTrue);
    expect(canVoiceFillCustomField(counsellorOnly, isAdmin: false, isCounsellor: true), isTrue);
  });
}
