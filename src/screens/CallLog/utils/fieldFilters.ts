import {
  CustomFieldDefinition,
  CustomFieldType,
} from '@/services/customFieldsApi.types';

/** A single field's filter value: text, a range tuple, or selected ids. */
export type FilterValue = string | string[];

/** Draft filter state keyed by CustomFieldDefinition id. */
export type FilterState = Record<string, FilterValue>;

/** The kind of input control a field type filters with. */
export type FilterControl = 'multiselect' | 'text' | 'number' | 'date';

export function controlForFieldType(fieldType: CustomFieldType): FilterControl {
  switch (fieldType) {
    case CustomFieldType.SINGLE_SELECT:
    case CustomFieldType.MULTI_SELECT:
    case CustomFieldType.BOOLEAN:
      return 'multiselect';
    case CustomFieldType.NUMBER:
      return 'number';
    case CustomFieldType.DATE:
      return 'date';
    case CustomFieldType.TEXT:
    default:
      return 'text';
  }
}

/** Options offered for a SELECT/BOOLEAN field, as {label, value} pairs. */
export function optionsForDef(
  def: CustomFieldDefinition,
): {label: string; value: string}[] {
  if (def.fieldType === CustomFieldType.BOOLEAN) {
    return [
      {label: 'Yes', value: 'true'},
      {label: 'No', value: 'false'},
    ];
  }
  return [...(def.options ?? [])]
    .sort((a, b) => a.order - b.order)
    .map(o => ({label: o.label, value: o.id}));
}

/** Whether a value counts as an active filter (non-empty). */
export function hasValue(value: FilterValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  return Array.isArray(value)
    ? value.some(v => v && v.trim() !== '')
    : value.trim() !== '';
}

/** Definitions that can be filtered on (filterable and active). */
export function filterableDefs(
  defs: CustomFieldDefinition[],
): CustomFieldDefinition[] {
  return defs.filter(d => d.filterable !== false);
}

export function countActiveFilters(state: FilterState): number {
  return Object.values(state).filter(hasValue).length;
}

/**
 * Serialises the draft state into the API `fieldFilters` query param (a JSON
 * array), or undefined when nothing is set.
 */
export function buildFieldFiltersParam(state: FilterState): string | undefined {
  const entries = Object.entries(state)
    .filter(([, value]) => hasValue(value))
    .map(([fieldDefinitionId, value]) => ({fieldDefinitionId, value}));

  return entries.length > 0 ? JSON.stringify(entries) : undefined;
}
