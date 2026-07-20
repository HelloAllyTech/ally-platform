import {
  CustomFieldDefinition,
  CustomFieldType,
} from '@/services/customFieldsApi.types';

/** A single field's filter value: text, a range tuple, or selected ids. */
export type FilterValue = string | string[];

/** Draft filter state keyed by field key (built-in key or definition id). */
export type FilterState = Record<string, FilterValue>;

/** The kind of input control a field filters with. */
export type FilterControl = 'multiselect' | 'text' | 'number' | 'date';

/** A unified filter field — a built-in column or a custom/default field. */
export interface FilterFieldDef {
  key: string;
  label: string;
  control: FilterControl;
  options?: {label: string; value: string}[];
  isBuiltin: boolean;
}

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

// ─── Built-in column filters (mirror the web scribe table) ──────────────────

const BUILTIN_KEYS = [
  'dateAndTime',
  'duration',
  'mode',
  'tags',
  'status',
  'source',
] as const;

const BUILTIN_KEY_SET = new Set<string>(BUILTIN_KEYS);

const MODE_OPTIONS = [
  {label: 'Scribe', value: 'SCRIBE'},
  {label: 'Dictation', value: 'DICTATION'},
];

const STATUS_OPTIONS = [
  {label: 'Generated', value: 'SUCCESS'},
  {label: 'Processing', value: 'PROCESSING'},
  {label: 'Error', value: 'FAILED'},
  {label: 'No Audio', value: 'NO_AUDIO'},
];

const CHANNEL_OPTIONS = [
  {label: 'Live Session', value: 'LIVE'},
  {label: 'Uploaded', value: 'UPLOAD'},
];

/** Built-in filter fields. Tags is included only when tag options exist. */
export function getBuiltinFilterFields(
  tagOptions: {label: string; value: string}[],
): FilterFieldDef[] {
  const fields: FilterFieldDef[] = [
    {
      key: 'dateAndTime',
      label: 'Date & Time',
      control: 'date',
      isBuiltin: true,
    },
    {
      key: 'duration',
      label: 'Duration (mins)',
      control: 'number',
      isBuiltin: true,
    },
    {
      key: 'mode',
      label: 'Mode',
      control: 'multiselect',
      options: MODE_OPTIONS,
      isBuiltin: true,
    },
    {
      key: 'status',
      label: 'Status',
      control: 'multiselect',
      options: STATUS_OPTIONS,
      isBuiltin: true,
    },
    {
      key: 'source',
      label: 'Channel',
      control: 'multiselect',
      options: CHANNEL_OPTIONS,
      isBuiltin: true,
    },
  ];
  if (tagOptions.length > 0) {
    fields.push({
      key: 'tags',
      label: 'Tags',
      control: 'multiselect',
      options: tagOptions,
      isBuiltin: true,
    });
  }
  return fields;
}

/** Definitions that can be filtered on (filterable and active). */
export function filterableDefs(
  defs: CustomFieldDefinition[],
): CustomFieldDefinition[] {
  return defs.filter(d => d.filterable !== false);
}

/** The full ordered list of filter fields: built-in first, then custom. */
export function getFilterFields(
  defs: CustomFieldDefinition[],
  tagOptions: {label: string; value: string}[] = [],
): FilterFieldDef[] {
  const customFields = filterableDefs(defs).map<FilterFieldDef>(def => ({
    key: def.id,
    label: def.name,
    control: controlForFieldType(def.fieldType),
    options: optionsForDef(def),
    isBuiltin: false,
  }));
  return [...getBuiltinFilterFields(tagOptions), ...customFields];
}

/** Whether a value counts as an active filter (non-empty). */
export function hasValue(value: FilterValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  return Array.isArray(value)
    ? value.some(v => v && v.trim() !== '')
    : value.trim() !== '';
}

export function countActiveFilters(state: FilterState): number {
  return Object.values(state).filter(hasValue).length;
}

/**
 * Serialises the custom/default-field entries (non-built-in keys) into the API
 * `fieldFilters` query param, or undefined when none are set.
 */
export function buildFieldFiltersParam(state: FilterState): string | undefined {
  const entries = Object.entries(state)
    .filter(([key, value]) => !BUILTIN_KEY_SET.has(key) && hasValue(value))
    .map(([fieldDefinitionId, value]) => ({fieldDefinitionId, value}));

  return entries.length > 0 ? JSON.stringify(entries) : undefined;
}

export interface BuiltinFilterParams {
  startDate?: string;
  endDate?: string;
  minDuration?: number;
  maxDuration?: number;
  tags?: string;
  mode?: string;
  status?: string;
  source?: string;
}

/**
 * Maps the built-in filter entries to API query params. Duration is entered in
 * minutes and converted to seconds (the backend column unit).
 */
export function buildBuiltinParams(state: FilterState): BuiltinFilterParams {
  const params: BuiltinFilterParams = {};

  const date = state.dateAndTime;
  if (Array.isArray(date)) {
    if (date[0]) params.startDate = date[0];
    if (date[1]) params.endDate = date[1];
  }

  const duration = state.duration;
  if (Array.isArray(duration)) {
    const [min, max] = duration;
    if (min && min.trim() !== '') params.minDuration = Number(min) * 60;
    if (max && max.trim() !== '') params.maxDuration = Number(max) * 60;
  }

  const csv = (key: keyof FilterState) => {
    const v = state[key];
    return Array.isArray(v) && v.length > 0 ? v.join(',') : undefined;
  };

  params.mode = csv('mode');
  params.status = csv('status');
  params.source = csv('source');
  params.tags = csv('tags');

  return params;
}
