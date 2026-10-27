import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Port of ally-mobile (React Native)'s `src/services/customFieldsApi.types.ts`
/// `CustomFieldType` enum — the backend's literal string values, so
/// `fromJson`/`toJson` round-trip exactly.
enum CustomFieldType {
  singleSelect('SINGLE_SELECT'),
  multiSelect('MULTI_SELECT'),
  date('DATE'),
  text('TEXT'),
  number('NUMBER'),
  boolean('BOOLEAN');

  const CustomFieldType(this.wireValue);
  final String wireValue;

  static CustomFieldType fromWire(String value) =>
      CustomFieldType.values.firstWhere((t) => t.wireValue == value, orElse: () => CustomFieldType.text);
}

/// Port of RN's `CustomFieldEditPermission` enum.
enum CustomFieldEditPermission {
  adminOnly('ADMIN_ONLY'),
  counsellorOnly('COUNSELLOR_ONLY'),
  both('BOTH');

  const CustomFieldEditPermission(this.wireValue);
  final String wireValue;

  static CustomFieldEditPermission fromWire(String value) => CustomFieldEditPermission.values.firstWhere(
    (p) => p.wireValue == value,
    orElse: () => CustomFieldEditPermission.both,
  );
}

/// Port of RN's `CustomFieldOption`.
class CustomFieldOption {
  const CustomFieldOption({required this.id, required this.label, required this.order});

  final String id;
  final String label;
  final int order;

  factory CustomFieldOption.fromJson(Map<String, dynamic> json) => CustomFieldOption(
    id: json['id'] as String,
    label: json['label'] as String,
    order: (json['order'] as num?)?.toInt() ?? 0,
  );
}

/// Port of RN's `CustomFieldDefinition` — a tenant-configured extra field
/// shown/edited on Call Summary and (when [filterable]) offered in the Call
/// Log filter sheet.
class CustomFieldDefinition {
  const CustomFieldDefinition({
    required this.id,
    required this.name,
    required this.fieldType,
    required this.sectionKey,
    required this.editPermission,
    this.options,
    this.showInTable = false,
    this.filterable = true,
  });

  final String id;
  final String name;
  final CustomFieldType fieldType;
  final String sectionKey;
  final CustomFieldEditPermission editPermission;
  final List<CustomFieldOption>? options;
  final bool showInTable;

  /// RN's `filterable?: boolean` — `?? true` matches its own
  /// `filterableDefs`'s `d.filterable !== false` (absent means filterable).
  final bool filterable;

  List<CustomFieldOption> get sortedOptions {
    final list = List<CustomFieldOption>.from(options ?? const []);
    list.sort((a, b) => a.order.compareTo(b.order));
    return list;
  }

  factory CustomFieldDefinition.fromJson(Map<String, dynamic> json) => CustomFieldDefinition(
    id: json['id'] as String,
    name: json['name'] as String,
    fieldType: CustomFieldType.fromWire(json['fieldType'] as String),
    sectionKey: json['sectionKey'] as String,
    editPermission: CustomFieldEditPermission.fromWire(json['editPermission'] as String),
    options: (json['options'] as List<dynamic>?)
        ?.map((e) => CustomFieldOption.fromJson(e as Map<String, dynamic>))
        .toList(),
    showInTable: json['showInTable'] as bool? ?? false,
    filterable: json['filterable'] as bool? ?? true,
  );
}

/// Port of RN's `CustomFieldValue` — one field's current value on one chat.
/// `value` is always the raw stored string: for SINGLE_SELECT/MULTI_SELECT
/// this is the option *label* (or a JSON-encoded array of labels), not the
/// option id — a real quirk of RN's own `CustomFieldsSection`, which builds
/// its dropdown/multi-select `options` from `option.label` and saves
/// whichever label the user picked, not `option.id`. Ported faithfully; the
/// filter sheet's option *values* are a separate representation (ids — see
/// `custom_fields_filter.dart`'s `optionsForDef`) used only for filtering.
class CustomFieldValue {
  const CustomFieldValue({required this.fieldDefinitionId, required this.value});

  final String fieldDefinitionId;
  final String? value;

  factory CustomFieldValue.fromJson(Map<String, dynamic> json) =>
      CustomFieldValue(fieldDefinitionId: json['fieldDefinitionId'] as String, value: json['value'] as String?);
}

/// Ported from ally-mobile (React Native)'s `src/services/customFieldsApi.ts`
/// (definitions/values/upsert — `getCustomFieldsEnabled` lives on
/// `SettingsRepository` instead, see its own doc comment for why).
class CustomFieldsRepository {
  CustomFieldsRepository(this._dio);

  final Dio _dio;

  /// `GET /custom-fields/definitions` — the tenant's full custom-field
  /// catalog, regardless of section.
  Future<List<CustomFieldDefinition>> getDefinitions() async {
    final response = await _dio.get<List<dynamic>>('/custom-fields/definitions');
    return (response.data ?? [])
        .map((e) => CustomFieldDefinition.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// `GET /custom-fields/values/:chatId` — one chat's currently-saved custom
  /// field values (only fields that have ever been set; an unset field is
  /// simply absent from this list, not returned with a null value).
  Future<List<CustomFieldValue>> getValues(int chatId) async {
    final response = await _dio.get<List<dynamic>>('/custom-fields/values/$chatId');
    return (response.data ?? []).map((e) => CustomFieldValue.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// `PUT /custom-fields/values/:chatId` — mirrors RN's
  /// `upsertCustomFieldValues` exactly: `value: null` explicitly clears a
  /// field (the backend reads an omitted `value` as "leave this column
  /// alone"), so callers must always send a real `null`, never omit the key.
  Future<void> upsertValues(int chatId, List<({String fieldDefinitionId, String? value})> values) async {
    await _dio.put<void>(
      '/custom-fields/values/$chatId',
      data: {
        'values': [for (final v in values) {'fieldDefinitionId': v.fieldDefinitionId, 'value': v.value}],
      },
    );
  }
}

final customFieldsRepositoryProvider = Provider<CustomFieldsRepository>((ref) {
  return CustomFieldsRepository(ref.watch(apiClientProvider));
});

/// Definitions are fetched regardless of [customFieldsEnabledProvider] by
/// this provider alone — callers (e.g. `call_summary_screen.dart`) are
/// expected to gate watching this on that toggle themselves, mirroring RN's
/// `skip: !customFieldsActive` rather than baking the gate in here (keeping
/// this provider composable for both the summary screen and the filter
/// sheet, which may want the catalog even when the tenant toggle is still
/// loading).
final customFieldDefinitionsProvider = FutureProvider<List<CustomFieldDefinition>>((ref) {
  return ref.watch(customFieldsRepositoryProvider).getDefinitions();
});

final customFieldValuesProvider = FutureProvider.family<List<CustomFieldValue>, int>((ref, chatId) {
  return ref.watch(customFieldsRepositoryProvider).getValues(chatId);
});
