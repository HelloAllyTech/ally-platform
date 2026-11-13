import { DataSource } from 'typeorm';
import { ListConstraintKind, ListFieldType } from '../enum/list.enum';
import {
  ListDefinitionsService,
  ListInput,
  ListRuleInput,
} from './list-definitions.service';
import { ListRecordsService } from './list-records.service';
import { loadList } from './list-store';
import type { ListActor } from './list-types';

/**
 * Slots, Appointments, Classes and Bookings for building and testing (chunk 5a; `npm run
 * lists:seed`). Written through the engine, so every rule applies. Running it again changes
 * nothing: a list that exists is left as it is, and a slot or class already there isn't added.
 */
export const SEED_TEST_PERSON = 'lists-seed:test-person';
const IST = '+05:30';
const ACTOR: ListActor = { kind: 'import', userId: null };

export const SEED_LISTS: (ListInput & { rules?: ListRuleInput[] })[] = [
  {
    key: 'slots',
    name: 'Slots',
    agent_read: true,
    agent_write: false,
    settings: { title_field: 'starts_at', default_sort: 'starts_at' },
    fields: [
      { key: 'practitioner', label: 'Practitioner', type: ListFieldType.TEXT },
      {
        key: 'starts_at',
        label: 'Starts at',
        type: ListFieldType.DATETIME,
        required: true,
      },
      {
        key: 'duration',
        label: 'Duration',
        type: ListFieldType.DURATION,
        default: 50,
      },
      {
        key: 'open',
        label: 'Open',
        type: ListFieldType.BOOLEAN,
        default: true,
      },
    ],
  },
  {
    key: 'appointments',
    name: 'Appointments',
    agent_read: true,
    agent_write: true,
    settings: { title_field: 'slot', person_field: 'client' },
    fields: [
      {
        key: 'slot',
        label: 'Slot',
        type: ListFieldType.RELATION,
        options: { to: 'slots' },
        required: true,
        agent_write: true,
      },
      {
        key: 'client',
        label: 'Client',
        type: ListFieldType.RELATION,
        options: { to: 'contact' },
        required: true,
      },
      {
        key: 'service',
        label: 'Service',
        type: ListFieldType.SELECT,
        options: {
          values: ['Individual therapy', 'Couples therapy', 'Family therapy'],
        },
        agent_write: true,
      },
      {
        key: 'status',
        label: 'Status',
        type: ListFieldType.SELECT,
        options: {
          values: ['booked', 'confirmed', 'completed', 'cancelled', 'no_show'],
        },
        default: 'booked',
        agent_write: true,
      },
      {
        key: 'notes',
        label: 'Notes',
        type: ListFieldType.LONG_TEXT,
        agent_read: false,
      },
    ],
    rules: [
      {
        kind: ListConstraintKind.UNIQUE,
        config: {
          fields: ['slot'],
          where: { field: 'status', not_in: ['cancelled'] },
        },
      },
      {
        kind: ListConstraintKind.LIMIT_PER_PERSON,
        config: {
          field: 'client',
          max: 2,
          where: { field: 'status', in: ['booked', 'confirmed'] },
        },
      },
      {
        kind: ListConstraintKind.TRANSITIONS,
        config: {
          field: 'status',
          initial: ['booked'],
          allowed: {
            booked: ['confirmed', 'cancelled'],
            confirmed: ['completed', 'cancelled', 'no_show'],
          },
        },
      },
    ],
  },
  {
    key: 'classes',
    name: 'Classes',
    agent_read: true,
    agent_write: false,
    settings: { title_field: 'name', default_sort: 'starts_at' },
    fields: [
      { key: 'name', label: 'Name', type: ListFieldType.TEXT, required: true },
      {
        key: 'starts_at',
        label: 'Starts at',
        type: ListFieldType.DATETIME,
        required: true,
      },
      {
        key: 'seats',
        label: 'Seats',
        type: ListFieldType.NUMBER,
        required: true,
        default: 20,
      },
    ],
  },
  {
    key: 'bookings',
    name: 'Bookings',
    agent_read: true,
    agent_write: true,
    settings: { title_field: 'class', person_field: 'member' },
    fields: [
      {
        key: 'class',
        label: 'Class',
        type: ListFieldType.RELATION,
        options: { to: 'classes' },
        required: true,
        agent_write: true,
      },
      {
        key: 'member',
        label: 'Member',
        type: ListFieldType.RELATION,
        options: { to: 'contact' },
        required: true,
      },
      {
        key: 'status',
        label: 'Status',
        type: ListFieldType.SELECT,
        options: { values: ['booked', 'cancelled'] },
        default: 'booked',
        agent_write: true,
      },
    ],
    rules: [
      {
        kind: ListConstraintKind.CAPACITY,
        config: {
          field: 'class',
          max_from: 'seats',
          where: { field: 'status', not_in: ['cancelled'] },
        },
      },
    ],
  },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** The Monday of next week, as a date in India (YYYY, M, D). */
export function nextMondayIst(now: Date): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = ist.getUTCDay(); // 0 Sunday … 6 Saturday
  const ahead = (8 - day) % 7 || 7;
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + ahead),
  );
}

const at = (
  day: Date,
  offsetDays: number,
  hour: number,
  minute = 0,
): string => {
  const d = new Date(day.getTime() + offsetDays * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(hour)}:${pad(minute)}:00${IST}`;
};

/** Next week's slots: weekdays, 10:00 to 16:00 starts, every 60 minutes, India time. */
export function seedSlotTimes(now: Date): string[] {
  const monday = nextMondayIst(now);
  const out: string[] = [];
  for (let day = 0; day < 5; day++) {
    for (let hour = 10; hour < 17; hour++) out.push(at(monday, day, hour));
  }
  return out;
}

export function seedClasses(now: Date): { name: string; starts_at: string }[] {
  const monday = nextMondayIst(now);
  return [
    { name: 'Morning yoga', starts_at: at(monday, 0, 7) },
    { name: 'Evening yoga', starts_at: at(monday, 2, 18) },
    { name: 'Breathwork', starts_at: at(monday, 4, 8) },
  ];
}

export interface ListSeedResult {
  testPersonId: string;
  lists: { key: string; id: string; created: boolean; records: number }[];
}

export async function seedLists(
  dataSource: DataSource,
  chatbotId: string,
  now = new Date(),
): Promise<ListSeedResult> {
  const definitions = new ListDefinitionsService(dataSource);
  const records = new ListRecordsService(dataSource);
  const m = dataSource.manager;

  const [bot] = await m.query(`SELECT id FROM chatbots WHERE id = $1`, [
    chatbotId,
  ]);
  if (!bot) throw new Error(`No chatbot ${chatbotId}`);

  // The Test person: a web contact of this bot, found again by its identity.
  let [person] = await m.query(
    `SELECT contact_id AS id FROM chatbot_contact_identities
      WHERE chatbot_id = $1 AND channel = 'web' AND external_id = $2`,
    [chatbotId, SEED_TEST_PERSON],
  );
  if (!person) {
    person = await dataSource.transaction(async (t) => {
      const [contact] = await t.query(
        `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, 'Test person') RETURNING id`,
        [chatbotId],
      );
      await t.query(
        `INSERT INTO chatbot_contact_identities (contact_id, chatbot_id, channel, external_id)
         VALUES ($1, $2, 'web', $3)`,
        [contact.id, chatbotId, SEED_TEST_PERSON],
      );
      return contact;
    });
  }

  const out: ListSeedResult = { testPersonId: person.id, lists: [] };
  for (const { rules, ...input } of SEED_LISTS) {
    let created = false;
    if (!(await loadList(m, chatbotId, input.key))) {
      await definitions.createList(chatbotId, input);
      for (const rule of rules ?? []) {
        await definitions.addRule(chatbotId, input.key, rule);
      }
      created = true;
    }
    const list = (await loadList(m, chatbotId, input.key))!;
    out.lists.push({
      key: input.key,
      id: list.collection.id,
      created,
      records: 0,
    });
  }

  const exists = async (key: string, startsAt: string, name?: string) => {
    const filters = [
      { field: 'starts_at', op: 'eq' as const, value: startsAt },
    ];
    if (name) filters.push({ field: 'name', op: 'eq' as const, value: name });
    const found = await records.query(chatbotId, key, ACTOR, {
      filters,
      limit: 1,
    });
    return found.total > 0;
  };
  for (const startsAt of seedSlotTimes(now)) {
    if (!(await exists('slots', startsAt))) {
      await records.create(chatbotId, 'slots', ACTOR, {
        practitioner: 'Dr Rohan',
        starts_at: startsAt,
      });
    }
  }
  for (const item of seedClasses(now)) {
    if (!(await exists('classes', item.starts_at, item.name))) {
      await records.create(chatbotId, 'classes', ACTOR, item);
    }
  }

  for (const list of out.lists) {
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM collection_records WHERE collection_id = $1 AND deleted_at IS NULL`,
      [list.id],
    );
    list.records = n;
  }
  return out;
}
