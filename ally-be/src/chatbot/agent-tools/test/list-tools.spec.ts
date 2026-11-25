import { BadRequestException } from '@nestjs/common';
import { ListConstraintKind, ListFieldType } from '../../enum/list.enum';
import type { ListDefinitionView } from '../../lists/list-definitions.service';
import {
  abilityFor,
  datedLists,
  FIND_LIMIT_DAY,
  FIND_LIMIT_DEFAULT,
  listDoneLine,
  listToolDefinitions,
  MAX_LIST_TOOLS,
  offeredListTools,
  parseListToolInput,
  parseListToolName,
  recordPassage,
  toListData,
  todayFor,
  toListQuery,
  withdrawable,
  withdrawOnlyDefinition,
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
  const dated = datedLists([slots, appointments]);
  const [find, create, update] = listToolDefinitions(
    appointments,
    names,
    dated,
  );
  const findSlots = listToolDefinitions(slots, names, dated)[0];
  const findListings = listToolDefinitions(listings, names)[0];

  // TF1 F9: "what did I book?" in a new chat asked for a name instead of looking it up.
  // TF1 F16: a Hindi question searched English entries with Hindi words and found nothing.
  it('a text filter says to search with the words the entries are written in', () => {
    const title = findListings.input_schema.properties.title_contains as {
      description: string;
    };
    expect(title.description).toMatch(/words the entries are written in/);
  });

  it("a person's list tells the model to look up their own entries first", () => {
    expect(find.description).toMatch(
      /only the entries of the person in this chat/,
    );
    expect(find.description).toMatch(/never ask for their name or phone/);
    expect(findListings.description).not.toMatch(/person in this chat/);
  });

  it('gives find filters by field type, with sort, limit and aggregate', () => {
    const p = findSlots.input_schema.properties;
    expect(Object.keys(p)).toEqual([
      'practitioner_contains',
      'starts_at_at',
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

  it('offers who a booking is for as for_person when the list has a Booked for detail (Q4 B13)', () => {
    const withFor = {
      ...appointments,
      fields: [
        ...appointments.fields,
        field('booked_for', ListFieldType.TEXT, { agent_write: true }),
      ],
    };
    const [, c, u] = listToolDefinitions(withFor, names, dated);
    const keys = Object.keys(c.input_schema.properties);
    expect(keys).toContain('for_person');
    expect(keys).not.toContain('booked_for');
    expect(c.input_schema.properties.for_person.description).toContain(
      'someone else',
    );
    expect(Object.keys(u.input_schema.properties)).not.toContain('for_person');
  });

  it('gives create the writable fields, never the person, and update an id', () => {
    expect(Object.keys(create.input_schema.properties)).toEqual([
      'slot',
      'service',
      'status',
      // Q4 G6: the name the person gave, kept as theirs (never the person link itself).
      'person_name',
    ]);
    expect(create.input_schema.properties.person_name.description).toContain(
      "The person's name",
    );
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

  it('marks a relation to a dated list, so ally-ai can check its day and time', () => {
    expect(create.input_schema.properties.slot).toMatchObject({
      relation: 'slots',
      dated: 'datetime',
    });
    expect(update.input_schema.properties.slot.dated).toBe('datetime');
    expect(create.input_schema.properties.service.relation).toBeUndefined();
  });

  it('gives find an exact time on a date-time field, and says when to use it', () => {
    expect(findSlots.input_schema.properties.starts_at_at.description).toBe(
      'Starts at is exactly: a date and time like 2026-11-20T11:15:00+05:30',
    );
    expect(findSlots.description).toContain(
      'When the person named a time, use starts_at_at to find exactly that time.',
    );
    expect(
      toListQuery(
        slots,
        parseListToolInput(findSlots, {
          starts_at_at: '2026-11-19T11:00:00+05:30',
        }),
      ).filters,
    ).toEqual([
      { field: 'starts_at', op: 'from', value: '2026-11-19T11:00:00+05:30' },
      { field: 'starts_at', op: 'to', value: '2026-11-19T11:00:00+05:30' },
    ]);
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

describe('today', () => {
  const now = new Date('2026-11-14T06:28:00Z');

  it('says the day, date, time and offset where the business is', () => {
    expect(todayFor(now)).toBe(
      'Saturday 14 Nov 2026, 11:58 (Asia/Kolkata, UTC+05:30)',
    );
    expect(todayFor(now, 'Europe/London')).toBe(
      'Saturday 14 Nov 2026, 06:28 (Europe/London, UTC+00:00)',
    );
  });

  it('falls back to the default for a time zone it doesn’t know', () => {
    expect(todayFor(now, 'Mars/Olympus')).toContain(
      '(Asia/Kolkata, UTC+05:30)',
    );
  });
});

describe('at least, for a number range that found nothing (8a)', () => {
  // Imported here: the service file pulls in Nest only for its class.
  const { withoutUpperBounds } = require('../list-tools.service');
  const tables = list('tables', 'Tables', [
    field('starts_at', ListFieldType.DATETIME),
    field('seats', ListFieldType.NUMBER),
    field('duration', ListFieldType.DURATION),
  ]);

  it('drops the upper bound of a number with a lower one: a table for 3 seats 2', () => {
    expect(
      withoutUpperBounds(tables, {
        starts_at_at: '2026-11-17T13:00:00+05:30',
        seats_from: '2',
        seats_to: '2',
      }),
    ).toEqual({ starts_at_at: '2026-11-17T13:00:00+05:30', seats_from: '2' });
  });

  it('leaves a lone upper bound, a duration, or no range alone', () => {
    expect(withoutUpperBounds(tables, { seats_to: '4' })).toBeNull();
    expect(
      withoutUpperBounds(tables, { duration_from: '30', duration_to: '30' }),
    ).toBeNull();
    expect(withoutUpperBounds(tables, {})).toBeNull();
  });
});

describe('chunk 6b: what the definitions carry', () => {
  const leads = list(
    'leads',
    'Leads',
    [
      field('name', ListFieldType.TEXT, { required: true, agent_write: true }),
      field('phone', ListFieldType.PHONE, {
        required: true,
        agent_write: true,
      }),
      field('interest', ListFieldType.SELECT, {
        options: { values: ['A demo', 'Pricing', 'Something else'] },
        agent_write: true,
      }),
      field('notes', ListFieldType.LONG_TEXT, { agent_write: true }),
    ],
    { agent_read: false, agent_write: true },
  );
  const create = (l: ListDefinitionView) =>
    listToolDefinitions(l).find((d) => d.kind === 'create')!;

  it('names the list as the owner wrote it, for the live steps', () => {
    expect(
      listToolDefinitions(slots).map((d) => [d.name, d.list_name]),
    ).toEqual([['find_slots', 'Slots']]);
  });

  it('marks a create on a list with a phone the assistant fills in as taking details', () => {
    expect(create(leads).takes_details).toBe(true);
    // Appointments has a person field but no phone: it books, it doesn't take details.
    expect(
      create({ ...appointments, agent_write: true }).takes_details,
    ).toBeUndefined();
    expect(
      listToolDefinitions(leads).find((d) => d.kind === 'update')!
        .takes_details,
    ).toBeUndefined();
  });

  it('leaves out an optional choice that still holds the ready-made examples (item 30)', () => {
    expect(Object.keys(create(leads).input_schema.properties)).toEqual([
      'name',
      'phone',
      'notes',
    ]);
    // A list installed before 6b, with the clinic's examples, in any order or case.
    const before = {
      ...leads,
      fields: leads.fields.map((f) =>
        f.key === 'interest'
          ? {
              ...f,
              options: { values: ['check-up', 'Consultation', 'Follow-up'] },
            }
          : f,
      ),
    };
    expect(create(before).input_schema.properties.interest).toBeUndefined();
    expect(JSON.stringify(listToolDefinitions(before))).not.toMatch(
      /Consultation/i,
    );
  });

  it("keeps the owner's own choices", () => {
    const own = {
      ...leads,
      fields: leads.fields.map((f) =>
        f.key === 'interest'
          ? { ...f, options: { values: ['Bookkeeping', 'GST filing'] } }
          : f,
      ),
    };
    expect(create(own).input_schema.properties.interest.enum).toEqual([
      '',
      'Bookkeeping',
      'GST filing',
    ]);
  });

  it('never drops a required choice, even with the examples', () => {
    const required = {
      ...leads,
      fields: leads.fields.map((f) =>
        f.key === 'interest' ? { ...f, required: true } : f,
      ),
    };
    expect(create(required).input_schema.properties.interest).toBeDefined();
  });
});

describe('chunk 6b: nothing in the stretch asked for', () => {
  const { nearestForWindow } = require('../list-tools.service');
  const t = (iso: string) => Date.parse(iso);
  const at = (r: string) => t(r);
  const slots = [
    '2026-11-19T14:00:00+05:30',
    '2026-11-19T15:00:00+05:30',
    '2026-11-19T16:00:00+05:30',
    '2026-11-20T10:00:00+05:30',
    '2026-11-20T18:00:00+05:30',
    '2026-11-20T19:00:00+05:30',
    '2026-11-20T20:00:00+05:30',
  ];

  it('"Thursday evening": the latest that day, then the next evening with times', () => {
    expect(
      nearestForWindow(
        slots,
        at,
        t('2026-11-19T17:00:00+05:30'),
        t('2026-11-19T23:59:00+05:30'),
      ),
    ).toEqual([
      '2026-11-19T16:00:00+05:30',
      '2026-11-20T18:00:00+05:30',
      '2026-11-20T19:00:00+05:30',
    ]);
  });

  it('with no evening later in the week, only the latest that day', () => {
    expect(
      nearestForWindow(
        slots.slice(0, 4),
        at,
        t('2026-11-19T17:00:00+05:30'),
        t('2026-11-19T23:59:00+05:30'),
      ),
    ).toEqual(['2026-11-19T16:00:00+05:30']);
  });

  it('a single time asked is left to nearness', () => {
    expect(
      nearestForWindow(slots, at, t('2026-11-19T11:00:00+05:30'), NaN),
    ).toEqual([]);
  });
});

describe('playbooks (Q3-fast Part 2b): what a list’s tools add', () => {
  const on = (names: string[]) =>
    ({
      abilities: Object.fromEntries(names.map((n) => [n, 'do_it'])),
    }) as never;
  const kinds = (offered: ReturnType<typeof offeredListTools>) =>
    Object.fromEntries(
      offered.definitions.map((d) => [d.name, d.playbook ?? null]),
    );

  it('a create with a date-and-time target books; a read-only list is reference', () => {
    const offered = offeredListTools(
      [slots, appointments],
      on(['find_slots', 'find_appointments', 'create_appointments']),
      { knowsPerson: true },
    );
    expect(kinds(offered)).toEqual({
      find_slots: 'reference',
      find_appointments: 'booking',
      create_appointments: 'booking',
    });
  });

  it('a list whose writes are at Never brings the read-only playbook', () => {
    const offered = offeredListTools(
      [slots, appointments],
      on(['find_appointments']),
      {
        knowsPerson: true,
      },
    );
    // Find is on unless set to Never, so Slots' find stays (reference too).
    expect(kinds(offered)).toEqual({
      find_slots: 'reference',
      find_appointments: 'reference',
    });
  });

  it('a create on a list with a phone field takes details', () => {
    const leads = list(
      'leads',
      'Leads',
      [
        field('name', ListFieldType.TEXT, { agent_write: true }),
        field('phone', ListFieldType.PHONE, { agent_write: true }),
      ],
      { agent_write: true },
    );
    const offered = offeredListTools([leads], on(['create_leads']), {
      knowsPerson: true,
    });
    expect(offered.definitions[0].playbook).toBe('details');
  });

  it("carries the owner's own line on every tool of the list, trimmed", () => {
    const products = list(
      'products',
      'Products',
      [field('title', ListFieldType.TEXT)],
      {
        settings: {
          instruction: '  Always mention the size chart.  ',
        } as never,
      },
    );
    const [def] = offeredListTools([products], on(['find_products']), {
      knowsPerson: true,
    }).definitions;
    expect(def).toMatchObject({
      playbook: 'reference',
      instruction: 'Always mention the size chart.',
    });
  });

  it('an assistant with no list tools gets no playbook at all', () => {
    const off = { abilities: { find_slots: 'never' } } as never;
    expect(
      offeredListTools([slots], off, { knowsPerson: true }).definitions,
    ).toEqual([]);
  });
});

describe('a find over a day (Q4 B7)', () => {
  it('returns at least 8, so every free time up to 8 can be listed', () => {
    const day = toListQuery(slots, {
      starts_at_from: '2026-11-27T00:00:00Z',
      starts_at_to: '2026-11-27T23:59:59Z',
      limit: 5,
    });
    expect(day.limit).toBe(FIND_LIMIT_DAY);
    expect(toListQuery(slots, { practitioner_contains: 'Rao' }).limit).toBe(
      FIND_LIMIT_DEFAULT,
    );
    expect(
      toListQuery(slots, { starts_at_from: '2026-11-27T00:00:00Z', limit: 10 })
        .limit,
    ).toBe(10);
  });
});

// TF1 B4: a person withdraws their own open request, even while Change is Never.
describe('withdrawing one’s own request (TF1 B4)', () => {
  const callbacks = list(
    'callback_requests',
    'Callback requests',
    [
      field('phone', ListFieldType.PHONE, { agent_write: true }),
      field('requester', ListFieldType.RELATION, {
        options: { to: 'contact' },
        agent_write: true,
      }),
      field('reason', ListFieldType.TEXT, { agent_write: true }),
      field('status', ListFieldType.SELECT, {
        options: { values: ['requested', 'called', 'closed', 'withdrawn'] },
      }),
    ],
    {
      agent_write: true,
      settings: { title_field: 'reason', person_field: 'requester' },
    },
  );
  const never = {
    abilities: {
      find_callback_requests: 'do_it',
      create_callback_requests: 'do_it',
      update_callback_requests: 'never',
    },
  } as never;

  it('offers a change tool that can only withdraw, while Change is Never', () => {
    const offered = offeredListTools([callbacks], never, { knowsPerson: true });
    const update = offered.definitions.find(
      (d) => d.name === 'update_callback_requests',
    )!;
    expect(Object.keys(update.input_schema.properties).sort()).toEqual([
      'id',
      'status',
    ]);
    expect(update.input_schema.properties.status).toMatchObject({
      enum: expect.arrayContaining(['withdrawn']),
    });
    expect(update.description).toMatch(/can't change anything else/);
  });

  it('a list without "withdrawn" offers no change tool at Never', () => {
    const plain = list(
      'donor_enquiries',
      'Donor enquiries',
      callbacks.fields.map((f) =>
        f.key === 'status'
          ? { ...f, options: { values: ['new', 'answered', 'closed'] } }
          : f,
      ),
      { agent_write: true, settings: callbacks.settings },
    );
    const offered = offeredListTools(
      [plain],
      {
        abilities: { update_donor_enquiries: 'never' },
      } as never,
      { knowsPerson: true },
    );
    expect(offered.definitions.map((d) => d.name)).not.toContain(
      'update_donor_enquiries',
    );
  });

  it('the withdraw-only tool refuses any other change', () => {
    const def = withdrawOnlyDefinition(callbacks);
    expect(() =>
      parseListToolInput(def, { id: 'r-1', status: 'withdrawn' }),
    ).not.toThrow();
    expect(() =>
      parseListToolInput(def, { id: 'r-1', status: 'called' }),
    ).toThrow();
    expect(() =>
      parseListToolInput(def, { id: 'r-1', phone: '+919800000009' }),
    ).toThrow();
  });

  it('only a person’s list with a "withdrawn" status is withdrawable', () => {
    expect(withdrawable(callbacks)).toBe(true);
    expect(withdrawable({ ...callbacks, settings: {} })).toBe(false);
  });
});
