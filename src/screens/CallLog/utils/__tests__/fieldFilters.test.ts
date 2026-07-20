// The helper imports from the lightweight customFieldsApi.types module (no RTK
// api / i18n chain), so the real enum can be used directly here.
import {CustomFieldType} from '@/services/customFieldsApi.types';

import {
  buildFieldFiltersParam,
  controlForFieldType,
  countActiveFilters,
  filterableDefs,
  optionsForDef,
} from '../fieldFilters';

describe('controlForFieldType', () => {
  it('maps types to controls', () => {
    expect(controlForFieldType(CustomFieldType.SINGLE_SELECT)).toBe('multiselect');
    expect(controlForFieldType(CustomFieldType.MULTI_SELECT)).toBe('multiselect');
    expect(controlForFieldType(CustomFieldType.BOOLEAN)).toBe('multiselect');
    expect(controlForFieldType(CustomFieldType.NUMBER)).toBe('number');
    expect(controlForFieldType(CustomFieldType.DATE)).toBe('date');
    expect(controlForFieldType(CustomFieldType.TEXT)).toBe('text');
  });
});

describe('optionsForDef', () => {
  it('returns Yes/No for BOOLEAN', () => {
    expect(optionsForDef({fieldType: CustomFieldType.BOOLEAN} as any)).toEqual([
      {label: 'Yes', value: 'true'},
      {label: 'No', value: 'false'},
    ]);
  });

  it('maps select options sorted by order', () => {
    const def = {
      fieldType: CustomFieldType.SINGLE_SELECT,
      options: [
        {id: 'b', label: 'B', order: 1},
        {id: 'a', label: 'A', order: 0},
      ],
    } as any;
    expect(optionsForDef(def)).toEqual([
      {label: 'A', value: 'a'},
      {label: 'B', value: 'b'},
    ]);
  });
});

describe('filterableDefs', () => {
  it('keeps only filterable !== false', () => {
    const defs = [
      {id: '1', filterable: true},
      {id: '2', filterable: false},
      {id: '3'},
    ] as any;
    expect(filterableDefs(defs).map(d => d.id)).toEqual(['1', '3']);
  });
});

describe('buildFieldFiltersParam / countActiveFilters', () => {
  it('serialises non-empty values and counts them', () => {
    const state = {
      a: 'anx',
      b: ['x', 'y'],
      c: '',
      d: [],
      e: ['', ''],
    };
    expect(countActiveFilters(state)).toBe(2);
    expect(JSON.parse(buildFieldFiltersParam(state)!)).toEqual([
      {fieldDefinitionId: 'a', value: 'anx'},
      {fieldDefinitionId: 'b', value: ['x', 'y']},
    ]);
  });

  it('returns undefined when nothing is set', () => {
    expect(buildFieldFiltersParam({})).toBeUndefined();
    expect(buildFieldFiltersParam({a: '', b: []})).toBeUndefined();
  });
});
