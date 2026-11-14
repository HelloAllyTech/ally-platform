import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from 'src/whatsapp/shared-store/test/shared-store.pg';
import { ListConstraintKind } from '../../enum/list.enum';
import { ListDefinitionsService } from '../list-definitions.service';
import { LIST_ENTITIES } from '../list-entities';
import { ListOwnerService } from '../list-owner.service';
import { ListRecordsService } from '../list-records.service';
import { ListRefusal, ListRefusalException } from '../list-refusals';
import { seedLists } from '../list-seed';
import type { ListActor } from '../list-types';
import { READY_MADE } from '../ready-made-lists';

const OWNER: ListActor = { kind: 'user', userId: 1 };
const AGENT: ListActor = { kind: 'agent', runId: 'run-5b' };

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
 * The owner's Lists section on real Postgres (chunk 5b): ready-made lists, the assistant's
 * switches, Repeat weekly until, `in_use` on delete, search, people and "Created by".
 */
describePg('Lists, the owner’s section (Postgres)', () => {
  let ds: DataSource;
  let definitions: ListDefinitionsService;
  let records: ListRecordsService;
  let owner: ListOwnerService;
  let bot: string;

  /** The settings service as the lists see it: the bot's hand-over zone, if it set one. */
  const settings = {
    getForChatbot: async (chatbot: { settings?: Record<string, unknown> }) =>
      chatbot.settings ?? {},
  };
  const chatbot = async (id = bot) => {
    const [row] = await ds.query(
      `SELECT id, settings, safety_pack AS "safetyPack" FROM chatbots WHERE id = $1`,
      [id],
    );
    return row;
  };
  const abilities = async (id = bot) =>
    (await chatbot(id)).settings?.abilities ?? {};

  beforeAll(async () => {
    ds = await openTestDataSource(LIST_ENTITIES);
    definitions = new ListDefinitionsService(ds);
    records = new ListRecordsService(ds);
    owner = new ListOwnerService(ds, definitions, records, settings as never);
  });
  afterAll(async () => closeTestDataSource(ds));
  beforeEach(async () => {
    await resetTables(ds);
    bot = await seedChatbot(ds, 'A');
  });

  describe('ready-made lists', () => {
    it.each(READY_MADE.map((item) => [item.name]))(
      '%s installs with its rules and no entries, Add and Change at Never',
      async (name) => {
        const item = READY_MADE.find((i) => i.name === name)!;
        const { lists } = await owner.install(await chatbot(), name);
        expect(lists.map((l) => l.key)).toEqual(item.lists.map((l) => l.key));
        for (const [i, list] of lists.entries()) {
          expect(list.rules).toHaveLength(item.lists[i].rules?.length ?? 0);
          expect(list.record_count).toBe(0);
          expect(list.abilities.create).toBe('never');
          expect(list.abilities.update).toBe('never');
          expect(list.abilities.find).toBe(
            item.lists[i].agent_read ? 'do_it' : 'never',
          );
          expect(list.time_zone).toBe('Asia/Kolkata');
        }
        const stored = await abilities();
        for (const list of item.lists) {
          expect(stored[`create_${list.key}`]).toBe('never');
          expect(stored[`update_${list.key}`]).toBe('never');
        }
      },
    );

    it('refuses a second install, and installs a pair all or nothing', async () => {
      await owner.install(await chatbot(), 'appointments');
      expect(
        await refusal(owner.install(await chatbot(), 'appointments')),
      ).toMatchObject({ code: 'invalid_value', field: 'key' });

      // Classes already there: Bookings needs it, and nothing of the pair is added.
      await definitions.createList(bot, { key: 'classes', name: 'Classes' });
      expect(
        await refusal(owner.install(await chatbot(), 'classes')),
      ).toMatchObject({ code: 'invalid_value' });
      const keys = (await definitions.listLists(bot)).map((l) => l.key);
      expect(keys).not.toContain('bookings');
    });

    it('rolls back the first list when a later step fails', async () => {
      const failing = new ListOwnerService(
        ds,
        {
          createList: definitions.createList.bind(definitions),
          getListIn: definitions.getListIn.bind(definitions),
          addRule: async () => {
            throw new Error('boom');
          },
        } as never,
        records,
        settings as never,
      );
      await expect(
        failing.install(await chatbot(), 'appointments'),
      ).rejects.toThrow('boom');
      expect(await definitions.listLists(bot)).toEqual([]);
    });

    it('installs the owner’s own options, and on a health pack keeps symptoms out', async () => {
      await ds.query(
        `UPDATE chatbots SET safety_pack = 'medical' WHERE id = $1`,
        [bot],
      );
      const { lists } = await owner.install(await chatbot(), 'appointments', {
        appointments: { service: ['Haircut', 'Colour'] },
      });
      const service = lists[1].fields.find((f) => f.key === 'service')!;
      expect(service.options).toEqual({ values: ['Haircut', 'Colour'] });
      const { lists: callbacks } = await owner.install(
        await chatbot(),
        'callback_requests',
      );
      const reason = callbacks[0].fields.find((f) => f.key === 'reason')!;
      expect(reason.privacy).toMatchObject({ never_store: true });
      expect(reason.required).toBe(false);
    });

    it('lists the catalogue grouped, with the options to fill in', () => {
      const { groups } = owner.catalogue();
      expect(groups.flatMap((g) => g.items)).toHaveLength(14);
      const appointments = groups[0].items[0];
      expect(appointments).toMatchObject({
        name: 'appointments',
        title: 'Appointments',
        needs_options: [
          {
            list: 'appointments',
            field: 'service',
            label: 'Service',
            examples: [
              'Individual therapy',
              'Couples therapy',
              'Family therapy',
            ],
          },
        ],
      });
    });
  });

  describe('the assistant’s switches', () => {
    beforeEach(async () => {
      await owner.install(await chatbot(), 'appointments');
      await ds.query(
        `UPDATE chatbots SET settings = jsonb_set(settings, '{abilities}', (settings->'abilities') || '{"hand_over":"never","find_other":"do_it"}') WHERE id = $1`,
        [bot],
      );
    });

    it('sets only this list’s keys and its agent switches', async () => {
      const view = await owner.setAbilities(bot, 'appointments', {
        create: 'do_it',
      });
      expect(view.abilities).toEqual({
        find: 'do_it',
        create: 'do_it',
        update: 'never',
      });
      expect(view.agent_read).toBe(true);
      expect(view.agent_write).toBe(true);
      const stored = await abilities();
      expect(stored).toMatchObject({
        create_appointments: 'do_it',
        update_appointments: 'never',
        hand_over: 'never',
        find_other: 'do_it',
      });

      const off = await owner.setAbilities(bot, 'appointments', {
        create: 'never',
        find: 'never',
      });
      expect(off.agent_read).toBe(false);
      expect(off.agent_write).toBe(false);
      expect((await abilities()).hand_over).toBe('never');
    });

    it('refuses Add on a list with nothing the assistant may fill in', async () => {
      expect(
        await refusal(owner.setAbilities(bot, 'slots', { create: 'do_it' })),
      ).toMatchObject({ code: 'invalid_value' });
      expect(
        await refusal(owner.setAbilities(bot, 'nothing', { find: 'never' })),
      ).toMatchObject({ code: 'not_found' });
    });
  });

  describe('Repeat weekly until', () => {
    const NOW = new Date('2026-11-14T06:00:00Z'); // Saturday, 11:30 in India
    const week = {
      field: 'starts_at',
      days: [1, 2, 3, 4, 5],
      start: '10:00',
      end: '17:00',
      every_minutes: 60,
      from: '2026-11-16',
      until: '2026-11-20',
    };

    beforeEach(async () => {
      await owner.install(await chatbot(), 'appointments');
    });

    it('counts first, then adds them; times already there are skipped', async () => {
      const dry = await owner.repeat(
        await chatbot(),
        'slots',
        OWNER,
        { ...week, dry_run: true },
        NOW,
      );
      expect(dry).toEqual({
        count: 35,
        skipped: 0,
        first: [
          'Mon 16 Nov 2026, 10:00',
          'Mon 16 Nov 2026, 11:00',
          'Mon 16 Nov 2026, 12:00',
          'Mon 16 Nov 2026, 13:00',
          'Mon 16 Nov 2026, 14:00',
        ],
        dry_run: true,
      });
      expect(
        (await records.query(bot, 'slots', OWNER, { aggregate: 'count' }))
          .total,
      ).toBe(0);

      await records.create(bot, 'slots', OWNER, {
        starts_at: '2026-11-17T04:30:00Z', // Tue 10:00 in India, written in UTC
      });
      const done = await owner.repeat(
        await chatbot(),
        'slots',
        OWNER,
        { ...week, values: { practitioner: 'Dr Mehta' } },
        NOW,
      );
      expect(done).toMatchObject({ count: 34, skipped: 1, dry_run: false });
      const all = await records.query(bot, 'slots', OWNER, { limit: 100 });
      expect(all.total).toBe(35);
      expect(
        all.records.filter((r) => r.data.practitioner === 'Dr Mehta'),
      ).toHaveLength(34);
      expect(all.records[0].data.starts_at).toBe('2026-11-16T10:00:00+05:30');

      const again = await owner.repeat(
        await chatbot(),
        'slots',
        OWNER,
        week,
        NOW,
      );
      expect(again).toMatchObject({ count: 0, skipped: 35 });
    });

    it('leaves out times already past', async () => {
      const today = await owner.repeat(
        await chatbot(),
        'slots',
        OWNER,
        {
          ...week,
          days: [6],
          from: '2026-11-14',
          until: '2026-11-14',
          dry_run: true,
        },
        NOW,
      );
      // 10:00 and 11:00 have gone; 12:00 to 16:00 are left.
      expect(today.count).toBe(5);
    });

    it('refuses more than 500 at a time, and adds none', async () => {
      expect(
        await refusal(
          owner.repeat(
            await chatbot(),
            'slots',
            OWNER,
            {
              ...week,
              days: [1, 2, 3, 4, 5, 6, 7],
              start: '00:00',
              end: '23:55',
              every_minutes: 5,
              until: '2026-11-30',
            },
            NOW,
          ),
        ),
      ).toMatchObject({
        code: 'limit_exceeded',
        message: 'This would go over the limit of 500 entries at a time.',
      });
      expect(
        (await records.query(bot, 'slots', OWNER, { aggregate: 'count' }))
          .total,
      ).toBe(0);
    });

    it('applies the list’s rules: one refusal and none are added', async () => {
      await definitions.addRule(bot, 'slots', {
        kind: ListConstraintKind.UNIQUE,
        config: { fields: ['practitioner'] },
      });
      expect(
        await refusal(
          owner.repeat(
            await chatbot(),
            'slots',
            OWNER,
            { ...week, values: { practitioner: 'Dr Mehta' } },
            NOW,
          ),
        ),
      ).toMatchObject({ code: 'unique_taken' });
      expect(
        (await records.query(bot, 'slots', OWNER, { aggregate: 'count' }))
          .total,
      ).toBe(0);
    });

    it('refuses a field that isn’t a date and time, and a bad week', async () => {
      expect(
        await refusal(
          owner.repeat(await chatbot(), 'slots', OWNER, {
            ...week,
            field: 'practitioner',
          }),
        ),
      ).toMatchObject({ code: 'invalid_value', field: 'practitioner' });
      expect(
        await refusal(
          owner.repeat(await chatbot(), 'slots', OWNER, { ...week, days: [] }),
        ),
      ).toMatchObject({ code: 'invalid_value', field: 'days' });
      expect(
        await refusal(
          owner.repeat(await chatbot(), 'slots', OWNER, {
            ...week,
            start: '17:00',
            end: '10:00',
          }),
        ),
      ).toMatchObject({ code: 'invalid_value', field: 'end' });
    });
  });

  describe('deleting an entry others use', () => {
    let person: string;
    let slot: string;

    beforeEach(async () => {
      person = (await seedLists(ds, bot)).testPersonId;
      slot = (await records.query(bot, 'slots', OWNER, { limit: 1 })).records[0]
        .id;
    });

    it('refuses while live bookings point at it, with the count; cancelled ones don’t count', async () => {
      const other = (
        await ds.query(
          `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, 'Asha') RETURNING id`,
          [bot],
        )
      )[0].id;
      const { record: booking } = await records.create(
        bot,
        'appointments',
        OWNER,
        { slot, client: person },
      );
      const cancelled = await records.update(
        bot,
        'appointments',
        OWNER,
        booking.id,
        { status: 'cancelled' },
        booking.version,
      );
      await records.create(bot, 'appointments', OWNER, {
        slot,
        client: other,
      });

      const refused = await refusal(records.delete(bot, 'slots', OWNER, slot));
      expect(refused).toMatchObject({
        code: 'in_use',
        message: '1 entry in Appointments uses this. Cancel or move it first.',
      });
      expect(refused.conflict!.records).toHaveLength(1);
      expect(refused.conflict!.records![0].id).not.toBe(cancelled.record.id);

      // Cancelled as well: now nothing live uses it.
      const live = (
        await records.query(bot, 'appointments', OWNER, {
          filters: [{ field: 'status', op: 'eq', value: 'booked' }],
        })
      ).records[0];
      await records.update(
        bot,
        'appointments',
        OWNER,
        live.id,
        { status: 'cancelled' },
        live.version,
      );
      await expect(
        records.delete(bot, 'slots', OWNER, slot),
      ).resolves.toBeDefined();
    });

    it('counts every live entry when no rule says otherwise, and says how many', async () => {
      await definitions.removeRule(
        bot,
        'appointments',
        (await definitions.getList(bot, 'appointments')).rules.find(
          (r) => r.kind === ListConstraintKind.UNIQUE,
        )!.id,
      );
      for (const name of ['A', 'B', 'C']) {
        const client = (
          await ds.query(
            `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, $2) RETURNING id`,
            [bot, name],
          )
        )[0].id;
        await records.create(bot, 'appointments', OWNER, { slot, client });
      }
      expect(
        (await refusal(records.delete(bot, 'slots', OWNER, slot))).message,
      ).toBe('3 entries in Appointments use this. Cancel or move them first.');
    });
  });

  describe('search, people and Created by', () => {
    let person: string;

    beforeEach(async () => {
      person = (await seedLists(ds, bot)).testPersonId;
    });

    it('searches every text detail, ignoring case, with the filters', async () => {
      await records.create(bot, 'slots', OWNER, {
        starts_at: '2030-01-01T10:00:00+05:30',
        practitioner: 'Dr MEHTA_x',
      });
      const found = await records.query(bot, 'slots', OWNER, {
        search: 'mehta_',
      });
      expect(found.total).toBe(1);
      expect(
        (
          await records.query(bot, 'slots', OWNER, {
            search: 'mehta',
            filters: [{ field: 'open', op: 'eq', value: false }],
          })
        ).total,
      ).toBe(0);
      // A wildcard is a character, not a pattern.
      expect(
        (await records.query(bot, 'slots', OWNER, { search: '%' })).total,
      ).toBe(0);
    });

    it('finds people by name or number, showing only the inbox label', async () => {
      const [wa] = await ds.query(
        `INSERT INTO chatbot_contacts (chatbot_id) VALUES ($1) RETURNING id`,
        [bot],
      );
      await ds.query(
        `INSERT INTO chatbot_contact_identities (contact_id, chatbot_id, channel, external_id)
         VALUES ($1, $2, 'whatsapp', '919876504821')`,
        [wa.id, bot],
      );
      const byNumber = await owner.contacts(bot, '98765');
      expect(byNumber.contacts).toEqual([
        { id: wa.id, name: 'Visitor · 4821', hint: 'WhatsApp' },
      ]);
      expect(JSON.stringify(byNumber)).not.toContain('919876504821');
      const byName = await owner.contacts(bot, 'test PER');
      expect(byName.contacts).toEqual([
        { id: person, name: 'Test person', hint: 'Bot page' },
      ]);
      const other = await seedChatbot(ds, 'B');
      expect((await owner.contacts(other, '')).contacts).toEqual([]);
    });

    it('shows a linked person by that label, and who made each entry', async () => {
      const slot = (await records.query(bot, 'slots', OWNER, { limit: 1 }))
        .records[0].id;
      const { record } = await records.create(bot, 'appointments', OWNER, {
        slot,
        client: person,
      });
      expect(record.display.client).toBe('Test person');
      expect(record.created_by).toMatchObject({ kind: 'user', you: true });

      await ds.query(
        `INSERT INTO tool_runs (chatbot_id, conversation_id, run_id, step, tool, input, status)
         VALUES ($1, 'conv-9', 'run-5b', 1, 'create_appointments', '{}', 'ok')`,
        [bot],
      );
      await ds.query(
        `UPDATE collections SET agent_write = true WHERE key = 'appointments'`,
      );
      const slot2 = (await records.query(bot, 'slots', OWNER, { limit: 2 }))
        .records[1].id;
      const { record: made } = await records.create(
        bot,
        'appointments',
        AGENT,
        { slot: slot2 },
        { contactId: person },
      );
      expect(made.created_by).toBeUndefined();
      const seen = await records.get(bot, 'appointments', OWNER, made.id);
      expect(seen.created_by).toEqual({
        kind: 'agent',
        conversation_id: 'conv-9',
      });
    });
  });
});
