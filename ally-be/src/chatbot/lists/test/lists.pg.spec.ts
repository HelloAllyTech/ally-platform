import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from 'src/whatsapp/shared-store/test/shared-store.pg';
import { ListConstraintKind, ListFieldType } from '../../enum/list.enum';
import { ListCsvService } from '../list-csv.service';
import { ListDefinitionsService } from '../list-definitions.service';
import { LIST_ENTITIES } from '../list-entities';
import { LIST_LIMITS } from '../list-limits';
import { ListRecordsService } from '../list-records.service';
import { ListRefusal, ListRefusalException } from '../list-refusals';
import { seedLists } from '../list-seed';
import type { ListActor, ListRecordView } from '../list-types';

const OWNER: ListActor = { kind: 'user', userId: 1 };
const AGENT: ListActor = { kind: 'agent', runId: 'run-5a' };
const IMPORT: ListActor = { kind: 'import', userId: 1 };

/** The refusal a write threw, or a failure if it didn't throw one. */
async function refusal(work: Promise<unknown>): Promise<ListRefusal> {
  try {
    await work;
  } catch (err) {
    if (err instanceof ListRefusalException) return err.refusal;
    throw err;
  }
  throw new Error('expected a refusal');
}

/**
 * The lists engine on real Postgres (chunk 5a): rules inside one locked transaction, the agent as
 * actor, per-person scoping, tenancy, definition changes, CSV and limits.
 */
describePg('Lists (Postgres)', () => {
  let ds: DataSource;
  let definitions: ListDefinitionsService;
  let records: ListRecordsService;
  let csv: ListCsvService;
  let bot: string;
  let other: string;
  let person: string;
  let slots: ListRecordView[];

  const contact = async (name: string, chatbotId = bot): Promise<string> =>
    (
      await ds.query(
        `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, $2) RETURNING id`,
        [chatbotId, name],
      )
    )[0].id;

  const book = (
    slot: string,
    client: string,
    extra: Record<string, unknown> = {},
  ) => records.create(bot, 'appointments', OWNER, { slot, client, ...extra });

  beforeAll(async () => {
    ds = await openTestDataSource(LIST_ENTITIES);
    definitions = new ListDefinitionsService(ds);
    records = new ListRecordsService(ds);
    csv = new ListCsvService(ds, records);
  });
  afterAll(async () => closeTestDataSource(ds));
  beforeEach(async () => {
    await resetTables(ds);
    bot = await seedChatbot(ds, 'A');
    other = await seedChatbot(ds, 'B');
    person = (await seedLists(ds, bot)).testPersonId;
    slots = (await records.query(bot, 'slots', OWNER, { limit: 100 })).records;
  });

  describe('booking', () => {
    it('lets exactly one of two concurrent bookings of a slot win; the other gets alternatives', async () => {
      const second = await contact('Second');
      const results = await Promise.allSettled([
        book(slots[0].id, person),
        book(slots[0].id, second),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ListRefusalException);
      const r = (lost.reason as ListRefusalException).refusal;
      expect(r).toMatchObject({
        code: 'unique_taken',
        field: 'slot',
        message: 'That slot is already taken.',
      });
      const alternatives = r.conflict!.alternatives!;
      expect(alternatives).toHaveLength(3);
      expect(alternatives.map((a) => a.id)).not.toContain(slots[0].id);
      expect(alternatives.map((a) => a.id)).toEqual([
        slots[1].id,
        slots[2].id,
        slots[3].id,
      ]);
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM collection_records WHERE data->>'slot' = $1`,
        [slots[0].id],
      );
      expect(n).toBe(1);
    });

    it('offers the free slots nearest the taken one: the same day first, then the nearest days', async () => {
      // Next week's slots, Monday to Friday, 10:00 to 16:00 each day (5a's seed).
      const thursdayNoon = slots.find(
        (s) => s.title.endsWith(', 12:00') && s.title.startsWith('Thu'),
      )!;
      const thursday11 = slots.find(
        (s) => s.title.startsWith('Thu') && s.title.endsWith(', 11:00'),
      )!;
      await book(thursdayNoon.id, person);
      await book(thursday11.id, await contact('Eleven'));
      const r = await refusal(book(thursdayNoon.id, await contact('Second')));
      const titles = r.conflict!.alternatives!.map((a) => a.title);
      // 13:00 (1 h), then 10:00 and 14:00 (2 h each), all on Thursday; 11:00 is taken too.
      expect(titles).toHaveLength(3);
      expect(titles[0]).toMatch(/^Thu .*, 13:00$/);
      expect(
        titles
          .slice(1)
          .map((t) => t.slice(-5))
          .sort(),
      ).toEqual(['10:00', '14:00']);
      expect(titles.every((t) => t.startsWith('Thu'))).toBe(true);
    });

    it('goes to the nearest days once the day is full', async () => {
      const thursday = slots.filter((s) => s.title.startsWith('Thu'));
      for (const [i, slot] of thursday.entries()) {
        await book(slot.id, await contact(`T${i}`));
      }
      const noon = thursday.find((s) => s.title.endsWith(', 12:00'))!;
      const r = await refusal(book(noon.id, await contact('Late')));
      expect(r.conflict!.alternatives!.map((a) => a.title)).toEqual([
        expect.stringMatching(/^(Wed|Fri) .*, 12:00$/),
        expect.stringMatching(/^(Wed|Fri) .*, 12:00$/),
        expect.stringMatching(/^(Wed|Fri) .*, (11|13):00$/),
      ]);
    });

    it('frees the slot when the booking is cancelled', async () => {
      const second = await contact('Second');
      const { record } = await book(slots[0].id, person);
      await records.update(
        bot,
        'appointments',
        OWNER,
        record.id,
        { status: 'cancelled' },
        record.version,
      );
      await expect(book(slots[0].id, second)).resolves.toBeDefined();
    });
  });

  describe('classes', () => {
    it('refuses the 21st booking in a class of 20, and lets it in when seats go up', async () => {
      const { record: cls } = await records.create(bot, 'classes', OWNER, {
        name: 'Spin',
        starts_at: '2030-01-07T07:00:00+05:30',
        seats: 20,
      });
      for (let i = 0; i < 20; i++) {
        await records.create(bot, 'bookings', OWNER, {
          class: cls.id,
          member: await contact(`M${i}`),
        });
      }
      const late = await contact('Late');
      const r = await refusal(
        records.create(bot, 'bookings', OWNER, { class: cls.id, member: late }),
      );
      expect(r).toMatchObject({
        code: 'capacity_full',
        message: 'Spin is full.',
      });
      // Nearest to the full class first (chunk 6): Spin is in 2030, after all three.
      expect(r.conflict!.alternatives!.map((a) => a.title)).toEqual([
        'Breathwork',
        'Evening yoga',
        'Morning yoga',
      ]);

      await records.update(
        bot,
        'classes',
        OWNER,
        cls.id,
        { seats: 21 },
        cls.version,
      );
      await expect(
        records.create(bot, 'bookings', OWNER, { class: cls.id, member: late }),
      ).resolves.toBeDefined();
    });
  });

  describe('per person', () => {
    it('refuses a third active booking; a cancelled one does not count', async () => {
      await book(slots[0].id, person);
      const { record: second } = await book(slots[1].id, person);
      const r = await refusal(book(slots[2].id, person));
      expect(r).toMatchObject({
        code: 'limit_reached',
        message: 'This person already has 2 appointments.',
      });
      await records.update(
        bot,
        'appointments',
        OWNER,
        second.id,
        { status: 'cancelled' },
        second.version,
      );
      await expect(book(slots[2].id, person)).resolves.toBeDefined();
    });
  });

  describe('transitions', () => {
    it('refuses booked → completed, passes booked → confirmed → completed, and refuses a create outside initial', async () => {
      const { record } = await book(slots[0].id, person);
      expect(
        await refusal(
          records.update(
            bot,
            'appointments',
            OWNER,
            record.id,
            { status: 'completed' },
            1,
          ),
        ),
      ).toMatchObject({
        code: 'transition_not_allowed',
        message: "Appointments can't go from booked to completed.",
      });
      const confirmed = await records.update(
        bot,
        'appointments',
        OWNER,
        record.id,
        { status: 'confirmed' },
        1,
      );
      await expect(
        records.update(
          bot,
          'appointments',
          OWNER,
          record.id,
          { status: 'completed' },
          confirmed.record.version,
        ),
      ).resolves.toBeDefined();
      expect(
        await refusal(book(slots[1].id, person, { status: 'completed' })),
      ).toMatchObject({ code: 'transition_not_allowed' });
    });
  });

  describe('the agent as actor', () => {
    beforeEach(async () => {
      await definitions.addField(bot, 'appointments', {
        key: 'card',
        label: 'Card',
        type: ListFieldType.TEXT,
        privacy: { masked: true },
        agent_write: true,
      });
      await definitions.addField(bot, 'appointments', {
        key: 'diagnosis',
        label: 'Diagnosis',
        type: ListFieldType.TEXT,
        privacy: { never_store: true },
        agent_read: true,
        agent_write: true,
      });
    });

    it("can't write a field with agent write off, a never_store field or the person field", async () => {
      const scope = { contactId: person };
      for (const [input, field] of [
        [{ slot: slots[0].id, notes: 'x' }, 'notes'],
        [{ slot: slots[0].id, diagnosis: 'x' }, 'diagnosis'],
        [{ slot: slots[0].id, client: person }, 'client'],
      ] as const) {
        expect(
          await refusal(
            records.create(bot, 'appointments', AGENT, input, scope),
          ),
        ).toMatchObject({ code: 'not_writable', field });
      }
      const { record } = await records.create(
        bot,
        'appointments',
        AGENT,
        { slot: slots[0].id },
        scope,
      );
      expect(record.data.client).toBe(person);
      const [event] = await ds.query(
        `SELECT run_id, actor FROM record_events WHERE record_id = $1`,
        [record.id],
      );
      expect(event).toEqual({
        run_id: 'run-5a',
        actor: { kind: 'agent', run_id: 'run-5a' },
      });
    });

    it('reads masked values masked, and never a never_store field', async () => {
      await book(slots[0].id, person, {
        card: '4111111111111234',
        diagnosis: 'private',
        notes: 'n',
      });
      const { records: seen } = await records.query(
        bot,
        'appointments',
        AGENT,
        {},
        { contactId: person },
      );
      expect(seen).toHaveLength(1);
      expect(seen[0].data.card).toBe('••••1234');
      expect(seen[0].data).not.toHaveProperty('diagnosis');
      expect(seen[0].data).not.toHaveProperty('notes');
      expect(JSON.stringify(seen[0])).not.toContain('private');
      expect(
        await refusal(
          records.query(
            bot,
            'appointments',
            AGENT,
            { filters: [{ field: 'card', op: 'eq', value: 'x' }] },
            { contactId: person },
          ),
        ),
      ).toMatchObject({ code: 'invalid_value' });
      const owner = await records.query(bot, 'appointments', OWNER);
      expect(owner.records[0].data).toMatchObject({
        card: '4111111111111234',
        diagnosis: 'private',
      });
    });

    it("sees only one contact's records when scoped, and nothing without a contact", async () => {
      const second = await contact('Second');
      await book(slots[0].id, person);
      const { record: theirs } = await book(slots[1].id, second);
      const mine = await records.query(
        bot,
        'appointments',
        AGENT,
        {},
        { contactId: person },
      );
      expect(mine.records.map((r) => r.data.client)).toEqual([person]);
      expect(mine.total).toBe(1);
      expect((await records.query(bot, 'appointments', AGENT)).records).toEqual(
        [],
      );
      expect(
        await refusal(
          records.update(
            bot,
            'appointments',
            AGENT,
            theirs.id,
            { status: 'cancelled' },
            undefined,
            { contactId: person },
          ),
        ),
      ).toMatchObject({ code: 'not_found' });
      // A shared list (no person field) isn't scoped.
      expect((await records.query(bot, 'slots', AGENT)).total).toBe(35);
    });
  });

  describe('tenancy', () => {
    it("refuses a relation to another bot's record, and no query crosses bots", async () => {
      await seedLists(ds, other);
      const theirPerson = await contact('B person', other);
      expect(
        await refusal(
          records.create(other, 'appointments', OWNER, {
            slot: slots[0].id,
            client: theirPerson,
          }),
        ),
      ).toMatchObject({ code: 'invalid_value', field: 'slot' });
      expect(
        await refusal(
          records.create(bot, 'appointments', OWNER, {
            slot: slots[0].id,
            client: theirPerson,
          }),
        ),
      ).toMatchObject({ code: 'invalid_value', field: 'client' });
      await book(slots[0].id, person);
      expect((await records.query(other, 'appointments', OWNER)).total).toBe(0);
      expect(
        await refusal(records.get(other, 'slots', OWNER, slots[0].id)),
      ).toMatchObject({ code: 'not_found' });
      const lonely = await seedChatbot(ds, 'C');
      expect(
        await refusal(records.query(lonely, 'slots', OWNER)),
      ).toMatchObject({ code: 'not_found' });
    });
  });

  describe('rules', () => {
    it('refuses a rule existing records break, and lists them', async () => {
      const second = await contact('Second');
      const a = await book(slots[0].id, person, { service: 'Couples therapy' });
      const b = await book(slots[1].id, second, { service: 'Couples therapy' });
      const r = await refusal(
        definitions.addRule(bot, 'appointments', {
          kind: ListConstraintKind.UNIQUE,
          config: { fields: ['service'] },
        }),
      );
      expect(r.code).toBe('invalid_value');
      expect(r.conflict!.records!.map((x) => x.id).sort()).toEqual(
        [a.record.id, b.record.id].sort(),
      );
      expect(
        (await definitions.getList(bot, 'appointments')).rules,
      ).toHaveLength(3);
    });
  });

  describe('changing fields', () => {
    it('refuses a type change while values exist; an archived field is hidden and keeps its values', async () => {
      expect(
        await refusal(
          definitions.updateField(bot, 'slots', 'practitioner', {
            type: ListFieldType.NUMBER,
          }),
        ),
      ).toMatchObject({ code: 'invalid_value', field: 'practitioner' });

      const { record } = await book(slots[0].id, person, { notes: 'keep me' });
      await definitions.archiveField(bot, 'appointments', 'notes');
      const seen = await records.get(bot, 'appointments', OWNER, record.id);
      expect(seen.data).not.toHaveProperty('notes');
      const [raw] = await ds.query(
        `SELECT data FROM collection_records WHERE id = $1`,
        [record.id],
      );
      expect(raw.data.notes).toBe('keep me');
      const list = await definitions.getList(bot, 'appointments');
      expect(
        list.fields.find((f) => f.key === 'notes')!.archived_at,
      ).not.toBeNull();
      expect(
        await refusal(
          records.update(
            bot,
            'appointments',
            OWNER,
            record.id,
            { notes: 'x' },
            seen.version,
          ),
        ),
      ).toMatchObject({ code: 'invalid_value', field: 'notes' });
      // A field a rule uses can't be archived.
      expect(
        await refusal(definitions.archiveField(bot, 'appointments', 'status')),
      ).toMatchObject({
        code: 'invalid_value',
      });
    });
  });

  describe('CSV', () => {
    it('round-trips an export through an import', async () => {
      await book(slots[0].id, person, { notes: '=HYPERLINK("x")' });
      const file = await csv.export(bot, 'appointments');
      expect(file.split('\r\n')[0]).toBe('id,slot,client,service,status,notes');
      expect(file).toContain(`'=HYPERLINK`);
      const before = await ds.query(
        `SELECT id, data, version FROM collection_records ORDER BY id`,
      );
      const result = await csv.import(
        bot,
        'appointments',
        IMPORT,
        Buffer.from(file),
        { commit: true },
      );
      expect(result).toMatchObject({
        rows: 1,
        updated: 1,
        created: 0,
        errors: [],
      });
      const after = await ds.query(
        `SELECT id, data FROM collection_records ORDER BY id`,
      );
      expect(after.map((r: { data: unknown }) => r.data)).toEqual(
        before.map((r: { data: unknown }) => r.data),
      );
    });

    it('reports errors per row in a dry run and saves nothing; an import cannot get past a rule', async () => {
      const { record } = await book(slots[0].id, person);
      const file = (await csv.export(bot, 'appointments')).replace(
        ',booked,',
        ',completed,',
      );
      const dry = await csv.import(
        bot,
        'appointments',
        IMPORT,
        Buffer.from(file),
      );
      expect(dry.dry_run).toBe(true);
      expect(dry.errors).toEqual([
        {
          row: 2,
          code: 'transition_not_allowed',
          field: 'status',
          message: "Appointments can't go from booked to completed.",
        },
      ]);

      const second = await contact('Second');
      const rows = [
        'slot,client,status',
        `${slots[5].id},${second},booked`,
        `${slots[5].id},Test person,booked`,
        `${slots[6].id},Nobody,booked`,
      ].join('\n');
      const dryNew = await csv.import(
        bot,
        'appointments',
        IMPORT,
        Buffer.from(rows),
      );
      expect(dryNew.created).toBe(1);
      expect(dryNew.errors.map((e) => [e.row, e.code])).toEqual([
        [3, 'unique_taken'],
        [4, 'invalid_value'],
      ]);
      expect((await records.query(bot, 'appointments', OWNER)).total).toBe(1);

      const committed = await csv.import(
        bot,
        'appointments',
        IMPORT,
        Buffer.from(rows),
        { commit: true },
      );
      expect(committed.created).toBe(1);
      expect((await records.query(bot, 'appointments', OWNER)).total).toBe(2);
      const stored = await records.get(bot, 'appointments', OWNER, record.id);
      expect(stored.data.status).toBe('booked');
    });
  });

  describe('limits and versions', () => {
    it('refuses a stale version', async () => {
      const { record } = await book(slots[0].id, person);
      await records.update(
        bot,
        'appointments',
        OWNER,
        record.id,
        { service: 'Couples therapy' },
        1,
      );
      expect(
        await refusal(
          records.update(
            bot,
            'appointments',
            OWNER,
            record.id,
            { status: 'cancelled' },
            1,
          ),
        ),
      ).toMatchObject({ code: 'version_conflict' });
    });

    it('refuses the 51st list, the 101st field, a record over 32 KB and records over the bot limit', async () => {
      for (let i = 4; i < LIST_LIMITS.listsPerBot; i++) {
        await definitions.createList(bot, { key: `l${i}`, name: `L${i}` });
      }
      expect(
        await refusal(
          definitions.createList(bot, { key: 'one_more', name: 'One more' }),
        ),
      ).toMatchObject({
        code: 'limit_exceeded',
        message: 'This would go over the limit of 50 lists.',
      });

      await definitions.createList(other, {
        key: 'wide',
        name: 'Wide',
        fields: Array.from({ length: 100 }, (_, i) => ({
          key: `f${i}`,
          label: `F${i}`,
          type: ListFieldType.LONG_TEXT,
        })),
      });
      expect(
        await refusal(
          definitions.addField(other, 'wide', {
            key: 'f100',
            label: 'F100',
            type: ListFieldType.TEXT,
          }),
        ),
      ).toMatchObject({ code: 'limit_exceeded' });
      const big = Object.fromEntries(
        [0, 1, 2, 3].map((i) => [`f${i}`, 'x'.repeat(9_000)]),
      );
      expect(
        await refusal(records.create(other, 'wide', OWNER, big)),
      ).toMatchObject({ code: 'limit_exceeded' });

      const limits = LIST_LIMITS as { recordsPerBot: number };
      const real = limits.recordsPerBot;
      limits.recordsPerBot = 1;
      try {
        await records.create(other, 'wide', OWNER, { f0: 'one' });
        expect(
          await refusal(records.create(other, 'wide', OWNER, { f0: 'two' })),
        ).toMatchObject({
          code: 'limit_exceeded',
        });
      } finally {
        limits.recordsPerBot = real;
      }
    });
  });

  describe('dry runs and the seed', () => {
    it('checks a dry-run write for real and saves nothing', async () => {
      const result = await records.create(
        bot,
        'appointments',
        AGENT,
        { slot: slots[0].id },
        { contactId: person, dryRun: true },
      );
      expect(result.dry_run).toBe(true);
      expect(result.record.data.status).toBe('booked');
      expect((await records.query(bot, 'appointments', OWNER)).total).toBe(0);
    });

    it('changes nothing when run again', async () => {
      const count = async () =>
        (await ds.query(`SELECT count(*)::int AS n FROM collection_records`))[0]
          .n +
        (await ds.query(`SELECT count(*)::int AS n FROM collections`))[0].n *
          1000 +
        (await ds.query(`SELECT count(*)::int AS n FROM chatbot_contacts`))[0]
          .n *
          1_000_000;
      const before = await count();
      const again = await seedLists(ds, bot);
      expect(again.testPersonId).toBe(person);
      expect(again.lists.every((l) => !l.created)).toBe(true);
      expect(again.lists.map((l) => [l.key, l.records])).toEqual([
        ['slots', 35],
        ['appointments', 0],
        ['classes', 3],
        ['bookings', 0],
      ]);
      expect(await count()).toBe(before);
    });
  });

  describe('reads', () => {
    it('filters by range and contains, sorts, pages with a cursor, and sums', async () => {
      const day = slots[7].data.starts_at as string; // Tuesday 10:00
      const tuesday = await records.query(bot, 'slots', OWNER, {
        filters: [
          { field: 'starts_at', op: 'from', value: day },
          { field: 'starts_at', op: 'to', value: day.replace('T10:', 'T23:') },
        ],
        sort: '-starts_at',
        limit: 4,
        aggregate: 'sum:duration',
      });
      expect(tuesday.total).toBe(7);
      expect(tuesday.aggregate).toEqual({ kind: 'sum:duration', value: 350 });
      expect(tuesday.records.map((r) => r.data.starts_at)).toEqual([
        day.replace('T10:', 'T16:'),
        day.replace('T10:', 'T15:'),
        day.replace('T10:', 'T14:'),
        day.replace('T10:', 'T13:'),
      ]);
      const page2 = await records.query(bot, 'slots', OWNER, {
        filters: [
          { field: 'starts_at', op: 'from', value: day },
          { field: 'starts_at', op: 'to', value: day.replace('T10:', 'T23:') },
        ],
        sort: '-starts_at',
        limit: 4,
        cursor: tuesday.next_cursor!,
      });
      expect(page2.records).toHaveLength(3);
      expect(page2.next_cursor).toBeNull();
      expect(
        (
          await records.query(bot, 'slots', OWNER, {
            filters: [{ field: 'practitioner', op: 'contains', value: 'roh' }],
          })
        ).total,
      ).toBe(35);
      expect(
        (
          await records.query(bot, 'slots', OWNER, {
            filters: [{ field: 'practitioner', op: 'contains', value: '%' }],
          })
        ).total,
      ).toBe(0);
    });

    it("titles a record by its relation's title", async () => {
      const { record } = await book(slots[0].id, person);
      expect(record.title).toBe(slots[0].title);
      expect(record.title).toMatch(/^Mon \d+ \w{3} \d{4}, 10:00$/);
      expect(record.display.client).toBe('Test person');
    });
  });
});
