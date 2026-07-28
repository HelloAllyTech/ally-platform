/**
 * Custom-field enums and shapes, kept separate from customFieldsApi so
 * lightweight consumers (e.g. the call-log filter helpers/UI) can import the
 * types without pulling in the RTK `api` module — and, transitively, the i18n
 * bootstrap that `api` triggers at load time.
 */

export enum CustomFieldType {
  SINGLE_SELECT = 'SINGLE_SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  DATE = 'DATE',
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
}

export enum CustomFieldEditPermission {
  ADMIN_ONLY = 'ADMIN_ONLY',
  COUNSELLOR_ONLY = 'COUNSELLOR_ONLY',
  BOTH = 'BOTH',
}

export interface CustomFieldOption {
  id: string;
  label: string;
  order: number;
}

export interface CustomFieldDefinition {
  id: string;
  name: string;
  fieldType: CustomFieldType;
  sectionKey: string;
  editPermission: CustomFieldEditPermission;
  options?: CustomFieldOption[];
  showInTable: boolean;
  /** Whether this field can be used to filter the call-log list. */
  filterable?: boolean;
}

export interface CustomFieldValue {
  fieldDefinitionId: string;
  value: string | null;
}

export interface UpsertCustomFieldValuesInput {
  // `null` clears the field and must be sent explicitly: JSON.stringify drops
  // undefined keys, and the backend reads a missing `value` as "leave this
  // column alone", so an omitted value silently refills the old one.
  values: {fieldDefinitionId: string; value?: string | null}[];
}
