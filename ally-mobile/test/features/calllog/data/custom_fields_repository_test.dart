import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/calllog/data/custom_fields_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

void main() {
  late MockDio dio;
  late CustomFieldsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = CustomFieldsRepository(dio);
  });

  group('CustomFieldType/CustomFieldEditPermission wire mapping', () {
    test('fromWire round-trips every real backend value', () {
      expect(CustomFieldType.fromWire('SINGLE_SELECT'), CustomFieldType.singleSelect);
      expect(CustomFieldType.fromWire('MULTI_SELECT'), CustomFieldType.multiSelect);
      expect(CustomFieldType.fromWire('DATE'), CustomFieldType.date);
      expect(CustomFieldType.fromWire('TEXT'), CustomFieldType.text);
      expect(CustomFieldType.fromWire('NUMBER'), CustomFieldType.number);
      expect(CustomFieldType.fromWire('BOOLEAN'), CustomFieldType.boolean);

      expect(CustomFieldEditPermission.fromWire('ADMIN_ONLY'), CustomFieldEditPermission.adminOnly);
      expect(CustomFieldEditPermission.fromWire('COUNSELLOR_ONLY'), CustomFieldEditPermission.counsellorOnly);
      expect(CustomFieldEditPermission.fromWire('BOTH'), CustomFieldEditPermission.both);
    });
  });

  group('CustomFieldDefinition.fromJson', () {
    test('parses a full single-select definition with sorted options', () {
      final def = CustomFieldDefinition.fromJson({
        'id': 'f1',
        'name': 'Referral Source',
        'fieldType': 'SINGLE_SELECT',
        'sectionKey': 'intake',
        'editPermission': 'BOTH',
        'options': [
          {'id': 'o2', 'label': 'Walk-in', 'order': 2},
          {'id': 'o1', 'label': 'Phone', 'order': 1},
        ],
        'showInTable': true,
        'filterable': true,
      });

      expect(def.id, 'f1');
      expect(def.fieldType, CustomFieldType.singleSelect);
      expect(def.sectionKey, 'intake');
      expect(def.editPermission, CustomFieldEditPermission.both);
      expect(def.sortedOptions.map((o) => o.label), ['Phone', 'Walk-in']);
      expect(def.showInTable, isTrue);
      expect(def.filterable, isTrue);
    });

    test('filterable defaults to true when absent from the JSON', () {
      final def = CustomFieldDefinition.fromJson({
        'id': 'f1',
        'name': 'x',
        'fieldType': 'TEXT',
        'sectionKey': 'intake',
        'editPermission': 'BOTH',
      });

      expect(def.filterable, isTrue);
      expect(def.showInTable, isFalse);
    });
  });

  group('getDefinitions', () {
    test('GETs the catalog and parses every entry', () async {
      when(() => dio.get<List<dynamic>>('/custom-fields/definitions')).thenAnswer(
        (_) async => _response([
          {'id': 'f1', 'name': 'A', 'fieldType': 'TEXT', 'sectionKey': 'intake', 'editPermission': 'BOTH'},
          {'id': 'f2', 'name': 'B', 'fieldType': 'NUMBER', 'sectionKey': 'intake', 'editPermission': 'ADMIN_ONLY'},
        ]),
      );

      final result = await repository.getDefinitions();

      expect(result, hasLength(2));
      expect(result[0].id, 'f1');
      expect(result[1].editPermission, CustomFieldEditPermission.adminOnly);
    });

    test('returns an empty list when the body is absent', () async {
      when(() => dio.get<List<dynamic>>('/custom-fields/definitions')).thenAnswer((_) async => _response(null));

      final result = await repository.getDefinitions();

      expect(result, isEmpty);
    });
  });

  group('getValues', () {
    test('GETs a chat\'s saved values', () async {
      when(() => dio.get<List<dynamic>>('/custom-fields/values/1001')).thenAnswer(
        (_) async => _response([
          {'fieldDefinitionId': 'f1', 'value': 'Walk-in'},
          {'fieldDefinitionId': 'f2', 'value': null},
        ]),
      );

      final result = await repository.getValues(1001);

      expect(result, hasLength(2));
      expect(result[0].value, 'Walk-in');
      expect(result[1].value, isNull);
    });
  });

  group('upsertValues', () {
    test('PUTs every value, sending an explicit null rather than omitting the key', () async {
      when(() => dio.put<void>('/custom-fields/values/1001', data: any(named: 'data')))
          .thenAnswer((_) async => _response(null));

      await repository.upsertValues(1001, [(fieldDefinitionId: 'f1', value: 'Walk-in'), (fieldDefinitionId: 'f2', value: null)]);

      final captured = verify(() => dio.put<void>('/custom-fields/values/1001', data: captureAny(named: 'data')))
          .captured
          .single as Map<String, dynamic>;
      expect(captured['values'], [
        {'fieldDefinitionId': 'f1', 'value': 'Walk-in'},
        {'fieldDefinitionId': 'f2', 'value': null},
      ]);
    });
  });
}
