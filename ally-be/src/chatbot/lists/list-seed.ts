import { DataSource } from 'typeorm';
import { ListFieldType } from '../enum/list.enum';
import {
  ListDefinitionsService,
  ListInput,
  ListRuleInput,
} from './list-definitions.service';
import { ListRecordsService } from './list-records.service';
import { loadList } from './list-store';
import type { ListActor } from './list-types';
import { listInputFor, readyMade } from './ready-made-lists';

/**
 * Slots, Appointments, Classes and Bookings for building and testing (chunk 5a; `npm run
 * lists:seed`). Written through the engine, so every rule applies. Running it again changes
 * nothing: a list that exists is left as it is, and a slot or class already there isn't added.
 */
export const SEED_TEST_PERSON = 'lists-seed:test-person';
const IST = '+05:30';
const ACTOR: ListActor = { kind: 'import', userId: null };

/**
 * The clinic and class lists, from the ready-made catalogue (chunk 5b: one source for both). The
 * seed turns the agent's list switch on where a field allows it, so 6's tools exist on a test bot;
 * whether a tool runs is still the bot's abilities.
 */
export const SEED_LISTS: (ListInput & { rules?: ListRuleInput[] })[] = [
  'appointments',
  'classes',
].flatMap((name) =>
  readyMade(name)!.lists.map((list) => {
    const input = listInputFor(list);
    return {
      ...input,
      agent_write: input.fields!.some((f) => f.agent_write),
    };
  }),
);

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

/**
 * The Listings fixture (chunk 6): a shared, read-only list of flats for "2BHK in Baner under 85
 * lakh" (find with ranges and equality). On its own test bot, beside or instead of the clinic lists.
 */
export const SEED_LISTINGS: ListInput = {
  key: 'listings',
  name: 'Listings',
  agent_read: true,
  agent_write: false,
  settings: { title_field: 'title', default_sort: 'price' },
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: ListFieldType.TEXT,
      required: true,
    },
    {
      key: 'locality',
      label: 'Locality',
      type: ListFieldType.SELECT,
      options: { values: ['Baner', 'Wakad', 'Kothrud'] },
      required: true,
    },
    {
      key: 'bhk',
      label: 'BHK',
      type: ListFieldType.SELECT,
      options: { values: ['1BHK', '2BHK', '3BHK'] },
      required: true,
    },
    {
      key: 'price',
      label: 'Price',
      type: ListFieldType.MONEY,
      options: { currency: 'INR' },
      required: true,
    },
    { key: 'area', label: 'Area (sq ft)', type: ListFieldType.NUMBER },
  ],
};

/** Twelve flats: in Baner, two 2BHKs under 85 lakh and one over. */
export const SEED_LISTING_RECORDS: Record<string, string | number>[] = [
  {
    title: 'Baner 2BHK, Pancard Club Road',
    locality: 'Baner',
    bhk: '2BHK',
    price: 7800000,
    area: 980,
  },
  {
    title: 'Baner 2BHK, Sus Road',
    locality: 'Baner',
    bhk: '2BHK',
    price: 8200000,
    area: 1020,
  },
  {
    title: 'Baner 2BHK, Balewadi High Street',
    locality: 'Baner',
    bhk: '2BHK',
    price: 9500000,
    area: 1100,
  },
  {
    title: 'Baner 1BHK, Mahalunge Road',
    locality: 'Baner',
    bhk: '1BHK',
    price: 5200000,
    area: 620,
  },
  {
    title: 'Baner 3BHK, Veerbhadra Nagar',
    locality: 'Baner',
    bhk: '3BHK',
    price: 14500000,
    area: 1550,
  },
  {
    title: 'Wakad 2BHK, Kaspate Wasti',
    locality: 'Wakad',
    bhk: '2BHK',
    price: 7200000,
    area: 950,
  },
  {
    title: 'Wakad 2BHK, Bhumkar Chowk',
    locality: 'Wakad',
    bhk: '2BHK',
    price: 6900000,
    area: 900,
  },
  {
    title: 'Wakad 1BHK, Datta Mandir Road',
    locality: 'Wakad',
    bhk: '1BHK',
    price: 4500000,
    area: 600,
  },
  {
    title: 'Wakad 3BHK, Hinjewadi Road',
    locality: 'Wakad',
    bhk: '3BHK',
    price: 11000000,
    area: 1400,
  },
  {
    title: 'Kothrud 2BHK, Karve Road',
    locality: 'Kothrud',
    bhk: '2BHK',
    price: 9900000,
    area: 1000,
  },
  {
    title: 'Kothrud 1BHK, Paud Road',
    locality: 'Kothrud',
    bhk: '1BHK',
    price: 6100000,
    area: 640,
  },
  {
    title: 'Kothrud 3BHK, Mayur Colony',
    locality: 'Kothrud',
    bhk: '3BHK',
    price: 17500000,
    area: 1700,
  },
];

/** The Listings list and its flats on a test bot. Running it again changes nothing. */
export async function seedListings(
  dataSource: DataSource,
  chatbotId: string,
): Promise<{ id: string; created: boolean; records: number }> {
  const definitions = new ListDefinitionsService(dataSource);
  const records = new ListRecordsService(dataSource);
  const m = dataSource.manager;
  let created = false;
  if (!(await loadList(m, chatbotId, SEED_LISTINGS.key))) {
    await definitions.createList(chatbotId, SEED_LISTINGS);
    created = true;
  }
  for (const flat of SEED_LISTING_RECORDS) {
    const found = await records.query(chatbotId, 'listings', ACTOR, {
      filters: [{ field: 'title', op: 'eq', value: flat.title }],
      limit: 1,
    });
    if (!found.total) await records.create(chatbotId, 'listings', ACTOR, flat);
  }
  const list = (await loadList(m, chatbotId, SEED_LISTINGS.key))!;
  const [{ n }] = await m.query(
    `SELECT count(*)::int AS n FROM collection_records WHERE collection_id = $1 AND deleted_at IS NULL`,
    [list.collection.id],
  );
  return { id: list.collection.id, created, records: n };
}
