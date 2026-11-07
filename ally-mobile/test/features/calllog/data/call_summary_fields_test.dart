import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/calllog/data/call_summary_fields.dart';

void main() {
  group('summaryFieldDefs catalog sanity', () {
    test('every field key is unique', () {
      final keys = summaryFieldDefs.map((f) => f.key).toList();
      expect(keys.toSet(), hasLength(keys.length));
    });

    test('every dropdown-type field declares non-empty options', () {
      final dropdowns = summaryFieldDefs.where(
        (f) => f.type == SummaryFieldType.dropdown,
      );

      expect(dropdowns, isNotEmpty);
      for (final field in dropdowns) {
        expect(
          field.options,
          isNotNull,
          reason: '${field.key} is a dropdown but has null options',
        );
        expect(
          field.options,
          isNotEmpty,
          reason: '${field.key} is a dropdown but has empty options',
        );
      }
    });

    test('non-dropdown fields declare no options', () {
      final nonDropdowns = summaryFieldDefs.where(
        (f) => f.type != SummaryFieldType.dropdown,
      );

      for (final field in nonDropdowns) {
        expect(
          field.options,
          isNull,
          reason: '${field.key} is not a dropdown but declares options',
        );
      }
    });

    test('every field belongs to one of the declared SummarySection values', () {
      for (final field in summaryFieldDefs) {
        expect(SummarySection.values, contains(field.section));
      }
    });

    test('field and section counts match the current catalog (truncation guard)', () {
      // Pinned to the catalog's current shape — a silent truncation (a
      // refactor accidentally dropping entries) changes one of these counts
      // without any other test catching it, since each field only asserts
      // its own shape in isolation.
      expect(summaryFieldDefs, hasLength(64));
      expect(summaryFieldDefs.map((f) => f.section).toSet(), hasLength(18));
      expect(SummarySection.values, hasLength(18));
    });

    test('every SummarySection has at least one field', () {
      final sectionsWithFields = summaryFieldDefs.map((f) => f.section).toSet();

      for (final section in SummarySection.values) {
        expect(
          sectionsWithFields,
          contains(section),
          reason: '${section.name} has no fields in the catalog',
        );
      }
    });

    test('every field has a non-empty label', () {
      for (final field in summaryFieldDefs) {
        expect(field.label, isNotEmpty, reason: '${field.key} has an empty label');
      }
    });

    test('read-only fields documented in the catalog header comment are all editable: false', () {
      const expectedReadOnly = {
        'callId',
        'callDuration',
        'callDate',
        'callTime',
        'clientId',
        'callType',
        'mode',
        'languages',
        'listeningShare',
        'reflectiveQuestionsAsked',
        'emotionalLift',
        'openEndedQuestionsAsked',
        'additionalNotes',
      };

      for (final key in expectedReadOnly) {
        final field = summaryFieldDefs.firstWhere((f) => f.key == key);
        expect(field.editable, isFalse, reason: '$key should be read-only');
      }
    });
  });

  group('tenant visible summary fields (RN /settings/summary-fields)', () {
    test('a section shows only when the list names one of its fields', () {
      expect(isSummarySectionVisible(SummarySection.flow, ['counselingProcessFlow']), isTrue);
      expect(isSummarySectionVisible(SummarySection.assessment, ['counselingProcessFlow']), isFalse);
      // RN hides on an empty or not-yet-loaded list too.
      expect(isSummarySectionVisible(SummarySection.flow, const []), isFalse);
      expect(isSummarySectionVisible(SummarySection.flow, null), isFalse);
    });

    test('Additional Notes is always visible', () {
      expect(isSummarySectionVisible(SummarySection.additionalNotes, const []), isTrue);
    });

    test('fields: empty list shows all, otherwise only listed ones', () {
      final age = summaryFieldDefs.firstWhere((f) => f.key == 'age');
      final gender = summaryFieldDefs.firstWhere((f) => f.key == 'gender');
      expect(isSummaryFieldVisible(age, const []), isTrue);
      expect(isSummaryFieldVisible(age, ['age']), isTrue);
      expect(isSummaryFieldVisible(gender, ['age']), isFalse);
    });
  });
}
