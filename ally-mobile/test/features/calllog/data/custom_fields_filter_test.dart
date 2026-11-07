import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/calllog/data/custom_fields_filter.dart';
import 'package:ally_mobile_flutter/features/calllog/data/custom_fields_repository.dart';

CustomFieldDefinition _def({
  required String id,
  required CustomFieldType fieldType,
  bool filterable = true,
  List<CustomFieldOption>? options,
}) => CustomFieldDefinition(
  id: id,
  name: 'Field $id',
  fieldType: fieldType,
  sectionKey: 'intake',
  editPermission: CustomFieldEditPermission.both,
  options: options,
  filterable: filterable,
);

void main() {
  group('controlForFieldType', () {
    test('select and boolean types use multiselect; number/date/text map directly', () {
      expect(controlForFieldType(CustomFieldType.singleSelect), FilterControl.multiselect);
      expect(controlForFieldType(CustomFieldType.multiSelect), FilterControl.multiselect);
      expect(controlForFieldType(CustomFieldType.boolean), FilterControl.multiselect);
      expect(controlForFieldType(CustomFieldType.number), FilterControl.number);
      expect(controlForFieldType(CustomFieldType.date), FilterControl.date);
      expect(controlForFieldType(CustomFieldType.text), FilterControl.text);
    });
  });

  group('optionsForDef', () {
    test('BOOLEAN synthesizes Yes/No options keyed by true/false', () {
      final options = optionsForDef(_def(id: 'f1', fieldType: CustomFieldType.boolean));
      expect(options, [(label: 'Yes', value: 'true'), (label: 'No', value: 'false')]);
    });

    test('SINGLE_SELECT/MULTI_SELECT options are sorted by order and keyed by id (not label)', () {
      final def = _def(
        id: 'f1',
        fieldType: CustomFieldType.singleSelect,
        options: [
          const CustomFieldOption(id: 'o2', label: 'Walk-in', order: 2),
          const CustomFieldOption(id: 'o1', label: 'Phone', order: 1),
        ],
      );
      final options = optionsForDef(def);
      expect(options, [(label: 'Phone', value: 'o1'), (label: 'Walk-in', value: 'o2')]);
    });
  });

  group('filterableDefs / customFieldFilterDefs', () {
    test('excludes definitions explicitly marked unfilterable', () {
      final defs = [
        _def(id: 'f1', fieldType: CustomFieldType.text),
        _def(id: 'f2', fieldType: CustomFieldType.text, filterable: false),
      ];
      expect(filterableDefs(defs).map((d) => d.id), ['f1']);
      expect(customFieldFilterDefs(defs).map((d) => d.id), ['f1']);
    });
  });

  group('hasFilterValue', () {
    test('non-empty string and list values count; empty/whitespace/null do not', () {
      expect(hasFilterValue('anx'), isTrue);
      expect(hasFilterValue(['x', 'y']), isTrue);
      expect(hasFilterValue(''), isFalse);
      expect(hasFilterValue('   '), isFalse);
      expect(hasFilterValue(<String>[]), isFalse);
      expect(hasFilterValue(['', '']), isFalse);
      expect(hasFilterValue(null), isFalse);
    });
  });

  group('buildFieldFiltersParam', () {
    test('serialises non-empty entries, preserving string vs. list value shapes', () {
      final param = buildFieldFiltersParam({'a': 'anx', 'b': ['x', 'y'], 'c': '', 'd': <String>[]});

      expect(
        jsonDecode(param!),
        [
          {'fieldDefinitionId': 'a', 'value': 'anx'},
          {'fieldDefinitionId': 'b', 'value': ['x', 'y']},
        ],
      );
    });

    test('returns null when nothing is set', () {
      expect(buildFieldFiltersParam({}), isNull);
      expect(buildFieldFiltersParam({'a': '', 'b': <String>[]}), isNull);
    });
  });
}
