import { BadRequestException } from '@nestjs/common';
import { ListConstraintKind, ListFieldType } from '../../enum/list.enum';
import type { ListDefinitionView } from '../../lists/list-definitions.service';
import {
  abilityFor,
  listDoneLine,
  listToolDefinitions,
  MAX_LIST_TOOLS,
  offeredListTools,
  parseListToolInput,
  parseListToolName,
  recordPassage,
  toListData,
  toListQuery,
} from '../list-tools';

type Field = ListDefinitionView['fields'][number];
let position = 0;
const field = (
  key: string,
  type: ListFieldType,
  extra: Partial<Field> = {},
): Field => ({
  key,
  label: key[0].toUpperCase() + key.slice(1).replace(/_/g, ' '),
  type,
  options: {},
  required: false,
  default: null,
  privacy: {},
  agent_read: true,
  agent_write: false,
  position: position++,
  archived_at: null,
  ...extra,
});

const list = (
  key: string,
  name: string,
  fields: Field[],
  extra: Partial<ListDefinitionView> = {},
): ListDefinitionView => ({
  id: `id-${key}`,
  key,
  name,
  settings: {},
  agent_read: true,
  agent_write: false,
  deleted_at: null,
  record_count: 0,
  fields,
  rules: [],
  ...extra,
});

/** 5a's seed, as definitions: slots (read only) and appointments (a person's, writable). */
const slots = list('slots', 'Slots', [
  field('practitioner', ListFieldType.TEXT),
  field('starts_at', ListFieldType.DATETIME, { required: true }),
  field('duration', ListFieldType.DURATION),
  field('open', ListFieldType.BOOLEAN),
]);
const appointments = list(
  'appointments',
  'Appointments',
  [
    field('slot', ListFieldType.RELATION, {
      options: { to: 'slots' },
      required: true,
      agent_write: true,
    }),
    field('client', ListFieldType.RELATION, {
      options: { to: 'contact' },
      required: true,
      agent_write: true,
    }),
    field('service', ListFieldType.SELECT, {
      options: { values: ['Individual therapy', 'Couples therapy'] },
      agent_write: true,
    }),
    field('status', ListFieldType.SELECT, {
      options: { values: ['booked', 'confirmed', 'cancelled'] },
      agent_write: true,
    }),
    field('notes', ListFieldType.LONG_TEXT, { agent_read: false }),
  ],
  {
    agent_write: true,
    settings: { title_field: 'slot', person_field: 'client' },
    rules: [
      {
        id: 'r1',
        kind: ListConstraintKind.UNIQUE,
        config: { fields: ['slot'] },
      },
      {
        id: 'r2',
        kind: ListConstraintKind.LIMIT_PER_PERSON,
        config: { field: 'client', max: 2 },
      },
      {
        id: 'r3',
        kind: ListConstraintKind.TRANSITIONS,
        config: {
          field: 'status',
          initial: ['booked'],
          allowed: {
            booked: ['confirmed', 'cancelled'],
            confirmed: ['cancelled'],
          },
        },
      },
    ],
  },
);
const listings = list('listings', 'Listings', [
  field('title', ListFieldType.TEXT),
  field('locality', ListFieldType.TEXT),
  field('bhk', ListFieldType.SELECT, {
    label: 'BHK',
    options: { values: ['1BHK', '2BHK', '3BHK'] },
  }),
  field('price', ListFieldType.MONEY),
  field('owner_phone', ListFieldType.PHONE, { privacy: { masked: true } }),
  field('secret', ListFieldType.TEXT, { privacy: { never_store: true } }),
]);
const names = new Map([
  ['slots', 'Slots'],
  ['appointments', 'Appointments'],
]);
const WRITES = {
  abilities: {
    create_appointments: 'do_it',
    update_appointments: 'do_it',
  },
} as never;

describe('list tool names and abilities', () => {
  it('parses a list tool name, and nothing else', () => {
    expect(parseListToolName('find_slots')).toEqual({
      kind: 'find',
      key: 'slots',
    });
    expect(parseListToolName('update_a_b')).toEqual({
      kind: 'update',
      key: 'a_b',
    });
    expect(parseListToolName('hand_over')).toBeNull();
    expect(parseListToolName('find_')).toBeNull();
  });

  it('reads are on and writes are off until set, and Never turns a find off', () => {
    expect(abilityFor(null, 'find_slots')).toBe('do_it');
    expect(abilityFor(null, 'create_slots')).toBe('never');
    expect(abilityFor(null, 'update_slots')).toBe('never');
    expect(abilityFor(null, 'hand_over')).toBe('never');
    expect(
      abilityFor({ abilities: { find_slots: 'never' } } as never, 'find_slots'),
    ).toBe('never');
    expect(abilityFor(WRITES, 'create_appointments')).toBe('do_it');
  });
});

describe('which tools a run gets', () => {
  const offered = (
    lists: ListDefinitionView[],
    stored: unknown = null,
    knowsPerson = true,
  ) =>
    offeredListTools(lists, stored as never, { knowsPerson }).definitions.map(
      (d) => d.name,
    );

  it('offers find for every readable list, and writes only when set to Do it', () => {
    expect(offered([slots, appointments])).toEqual([
      'find_slots',
      'find_appointments',
    ]);
    expect(offered([slots, appointments], WRITES)).toEqual([
      'find_slots',
      'find_appointments',
      'create_appointments',
      'update_appointments',
    ]);
  });

  it('offers nothing for a list without agent read, a deleted list, or a find set to Never', () => {
    expect(offered([{ ...slots, agent_read: false }])).toEqual([]);
    expect(offered([{ ...slots, deleted_at: '2026-11-01' }])).toEqual([]);
    expect(offered([slots], { abilities: { find_slots: 'never' } })).toEqual(
      [],
    );
  });

  it('offers no write tools for a list with no writable field', () => {
    const readOnly = {
      ...appointments,
      fields: appointments.fields.map((f) => ({ ...f, agent_write: false })),
    };
    expect(
      offered([readOnly], {
        abilities: { create_appointments: 'do_it' },
      }),
    ).toEqual(['find_appointments']);
  });

  it('leaves out the tools of person lists when the person is not known', () => {
    expect(offered([slots, appointments], WRITES, false)).toEqual([
      'find_slots',
    ]);
  });

  it('caps at 12 in list order and names the rest', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      list(`l${i}`, `List ${i}`, [field('name', ListFieldType.TEXT)]),
    );
    const result = offeredListTools(many, null, { knowsPerson: true });
    expect(result.definitions).toHaveLength(MAX_LIST_TOOLS);
    expect(result.definitions[0].name).toBe('find_l0');
    expect(result.omitted).toEqual(['find_l12', 'find_l13']);
  });
});

describe('schemas', () => {
  const [find, create, update] = listToolDefinitions(appointments, names);
  const findSlots = listToolDefinitions(slots, names)[0];
  const findListings = listToolDefinitions(listings, names)[0];

  it('gives find filters by field type, with sort, limit and aggregate', () => {
    const p = findSlots.input_schema.properties;
    expect(Object.keys(p)).toEqual([
      'practitioner_contains',
      'starts_at_from',
      'starts_at_to',
      'duration_from',
      'duration_to',
      'open',
      'sort',
      'limit',
      'aggregate',
    ]);
    expect(p.open.enum).toEqual(['', 'yes', 'no']);
    expect(p.starts_at_from.description).toContain('2026-11-20T11:15:00+05:30');
    expect(p.limit).toMatchObject({
      type: 'integer',
      default: 5,
      minimum: 1,
      maximum: 10,
    });
    expect(p.aggregate.enum).toEqual(['', 'count', 'sum_duration']);
    expect(p.sort.enum).toContain('-starts_at');
    for (const prop of Object.values(p)) expect(prop).toHaveProperty('default');
  });

  it('never filters on a masked, never_store or unreadable field, or a contact', () => {
    expect(Object.keys(findListings.input_schema.properties)).toEqual([
      'title_contains',
      'locality_contains',
      'bhk',
      'price_from',
      'price_to',
      'sort',
      'limit',
      'aggregate',
    ]);
    expect(findListings.input_schema.properties.bhk.enum).toEqual([
      '',
      '1BHK',
      '2BHK',
      '3BHK',
    ]);
    expect(Object.keys(find.input_schema.properties)).not.toContain('client');
    expect(Object.keys(find.input_schema.properties)).not.toContain('notes');
  });

  it('gives create the writable fields, never the person, and update an id', () => {
    expect(Object.keys(create.input_schema.properties)).toEqual([
      'slot',
      'service',
      'status',
    ]);
    expect(create.input_schema.properties.slot.description).toContain(
      'the id of a slots entry from find_slots',
    );
    expect(create.input_schema.properties.service.enum).toEqual([
      '',
      'Individual therapy',
      'Couples therapy',
    ]);
    expect(Object.keys(update.input_schema.properties)).toEqual([
      'id',
      'slot',
      'service',
      'status',
    ]);
    expect(update.input_schema.properties.status.description).toContain(
      'empty leaves it as it is',
    );
  });

  it('writes descriptions from the list and its rules', () => {
    expect(findListings.description).toBe(
      'Look up entries in Listings. Filter by title, locality, BHK and price; returns up to 10 ' +
        'matches as passages to cite, with the total. Use aggregate to count or to add up price.',
    );
    expect(create.description).toBe(
      "Add an entry to Appointments for the person in this chat, only after they've " +
        'confirmed it. Needs slot. Fails with a reason if that slot is already taken. Fails ' +
        'if the person already has 2 appointments.',
    );
    expect(update.description).toBe(
      'Change an entry in Appointments that belongs to the person in this chat; id comes ' +
        'from find_appointments. Fails with a reason if that slot is already taken. Fails if ' +
        'the person already has 2 appointments. Status can change from booked to confirmed ' +
        'or cancelled; from confirmed to cancelled.',
    );
  });
});

describe('input', () => {
  const [find, create, update] = listToolDefinitions(appointments, names);
  const findListings = listToolDefinitions(listings, names)[0];

  it('drops empty values and refuses unknown fields, bad enums and bad limits', () => {
    expect(parseListToolInput(find, { status: '', limit: 3 })).toEqual({
      limit: 3,
    });
    expect(() => parseListToolInput(find, { who: 'x' })).toThrow(
      BadRequestException,
    );
    expect(() => parseListToolInput(create, { service: 'Yoga' })).toThrow(
      BadRequestException,
    );
    expect(() => parseListToolInput(find, { limit: 11 })).toThrow(
      BadRequestException,
    );
    expect(() => parseListToolInput(create, { slot: 5 })).toThrow(
      BadRequestException,
    );
  });

  it('turns find input into the engine query: ranges, equality, contains, sort, aggregate', () => {
    const input = parseListToolInput(findListings, {
      bhk: '2BHK',
      locality_contains: 'Baner',
      price_to: '85,00,000',
      sort: 'price',
      aggregate: 'sum_price',
    });
    expect(toListQuery(listings, input)).toEqual({
      filters: [
        { field: 'locality', op: 'contains', value: 'Baner' },
        { field: 'bhk', op: 'eq', value: '2BHK' },
        { field: 'price', op: 'to', value: 8500000 },
      ],
      sort: 'price',
      limit: 5,
      aggregate: 'sum:price',
    });
    expect(
      toListQuery(
        listings,
        parseListToolInput(findListings, { aggregate: 'count' }),
      ).aggregate,
    ).toBe('count');
  });

  it('turns create and update input into data, without the id or the person', () => {
    expect(
      toListData(
        appointments,
        parseListToolInput(update, {
          id: 'abc',
          status: 'cancelled',
          slot: '',
        }),
      ),
    ).toEqual({ status: 'cancelled' });
  });
});

describe('results', () => {
  it('renders a record as a passage: the list and title, its id, readable fields only', () => {
    const passage = recordPassage(appointments, {
      id: 'rec-1',
      version: 1,
      title: 'Thu 19 Nov 2026, 11:00',
      data: {},
      display: {
        slot: 'Thu 19 Nov 2026, 11:00',
        client: 'Test person',
        status: 'booked',
        notes: 'private',
      },
      contact_id: 'c1',
      created_at: '',
      updated_at: '',
    });
    expect(passage).toEqual({
      record_id: 'rec-1',
      list: 'Appointments',
      title: 'Appointments: Thu 19 Nov 2026, 11:00',
      record_title: 'Thu 19 Nov 2026, 11:00',
      text: 'id: rec-1\nSlot: Thu 19 Nov 2026, 11:00\nClient: Test person\nStatus: booked',
    });
  });

  it('says what was done when a run fails after a write (copy deck §26)', () => {
    expect(listDoneLine('Thu 19 Nov 2026, 11:00', 'Appointments')).toBe(
      'Done: Thu 19 Nov 2026, 11:00 in Appointments.',
    );
  });
});
