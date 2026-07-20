// The helper imports from the lightweight customFieldsApi.types module (no RTK
// api / i18n chain), so the real enum can be used directly here.
import {CustomFieldType} from '@/services/customFieldsApi.types';

import {
  buildBuiltinParams,
  buildFieldFiltersParam,
  controlForFieldType,
  countActiveFilters,
  filterableDefs,
  getFilterFields,
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

  it('excludes built-in keys from the custom fieldFilters param', () => {
    const param = buildFieldFiltersParam({
      mode: ['SCRIBE'],
      duration: ['5', '10'],
      customUuid: 'anx',
    });
    expect(JSON.parse(param!)).toEqual([
      {fieldDefinitionId: 'customUuid', value: 'anx'},
    ]);
  });
});

describe('buildBuiltinParams', () => {
  it('maps built-in keys to API params (duration minutes -> seconds)', () => {
    const params = buildBuiltinParams({
      dateAndTime: ['2026-01-01', '2026-02-01'],
      duration: ['5', '10'],
      mode: ['SCRIBE', 'DICTATION'],
      status: ['SUCCESS'],
      source: ['UPLOAD'],
      tags: ['anxiety'],
      someCustom: 'ignored',
    });
    expect(params).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      minDuration: 300,
      maxDuration: 600,
      mode: 'SCRIBE,DICTATION',
      status: 'SUCCESS',
      source: 'UPLOAD',
      tags: 'anxiety',
    });
  });

  it('leaves unset built-in params undefined', () => {
    const params = buildBuiltinParams({mode: ['DICTATION']});
    expect(params.mode).toBe('DICTATION');
    expect(params.status).toBeUndefined();
    expect(params.startDate).toBeUndefined();
    expect(params.minDuration).toBeUndefined();
  });
});

describe('getFilterFields', () => {
  it('lists built-in fields first, then filterable custom fields', () => {
    const fields = getFilterFields(
      [
        {
          id: 'd1',
          name: 'Diagnosis',
          fieldType: CustomFieldType.TEXT,
          filterable: true,
        },
      ] as any,
      [{label: 'anx', value: 'anx'}],
    );
    const keys = fields.map(f => f.key);
    // Built-in keys present (incl. tags because tagOptions provided)
    expect(keys).toEqual(
      expect.arrayContaining([
        'dateAndTime',
        'duration',
        'mode',
        'status',
        'source',
        'tags',
        'd1',
      ]),
    );
    // Custom field comes after the built-ins
    expect(keys.indexOf('d1')).toBeGreaterThan(keys.indexOf('source'));
  });

  it('omits the Tags field when no tag options exist', () => {
    const fields = getFilterFields([], []);
    expect(fields.map(f => f.key)).not.toContain('tags');
  });
});
