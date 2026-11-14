import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from 'src/whatsapp/shared-store/test/shared-store.pg';
import { ListDefinitionsService } from '../../lists/list-definitions.service';
import { LIST_ENTITIES } from '../../lists/list-entities';
import { ListRecordsService } from '../../lists/list-records.service';
import { seedLists } from '../../lists/list-seed';
import { AgentGatewayService } from '../agent-gateway.service';
import { AgentRunTokenService } from '../agent-run-token.service';
import { ListToolsService } from '../list-tools.service';
import { AgentToolRegistry } from '../tools';
import { appConfig, SERVICE_KEY } from './agent-tools.fakes';

const TOOLS = [
  'find_slots',
  'find_appointments',
  'create_appointments',
  'update_appointments',
];

/**
 * The generated list tools through the real gateway and 5a's engine (chunk 6): per-person scoping,
 * Preview rolled back, refusals with alternatives, replays, and no bot reaching another's lists.
 */
describePg('List tools through the gateway (Postgres)', () => {
  let ds: DataSource;
  let gateway: AgentGatewayService;
  let tokens: AgentRunTokenService;
  let lists: ListToolsService;
  let bot: string;
  let other: string;
  let alice: string;
  let bob: string;
  let run = 0;

  const contact = async (name: string, chatbotId = bot): Promise<string> =>
    (
      await ds.query(
        `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, $2) RETURNING id`,
        [chatbotId, name],
      )
    )[0].id;

  /** One call in a fresh run, as `contactId` in `conversationId`. */
  const call = async (
    name: string,
    input: Record<string, unknown>,
    opts: {
      contactId?: string | null;
      conversationId?: string;
      chatbotId?: string;
      runId?: string;
      step?: number;
    } = {},
  ) => {
    const runId = opts.runId ?? `run-6-${++run}`;
    const token = tokens.sign({
      chatbotId: opts.chatbotId ?? bot,
      conversationId: opts.conversationId ?? `conv-${runId}`,
      runId,
      contactId: opts.contactId === undefined ? alice : opts.contactId,
      tools: TOOLS,
    });
    return gateway.call(
      name,
      { apiKey: SERVICE_KEY, authorization: `Bearer ${token}` },
      { run_id: runId, step: opts.step ?? 0, input },
    ) as Promise<{
      ok: boolean;
      error?: string;
      replayed: boolean;
      result?: Record<string, any>;
    }>;
  };

  const freeSlots = async (limit = 3) =>
    (await call('find_slots', { open: 'yes', sort: 'starts_at', limit }))
      .result!.passages as {
      record_id: string;
      record_title: string;
      text: string;
    }[];

  const appointmentRows = async () =>
    ds.query(
      `SELECT r.id, r.contact_id, r.data FROM collection_records r
         JOIN collections c ON c.id = r.collection_id
        WHERE c.chatbot_id = $1 AND c.key = 'appointments' AND r.deleted_at IS NULL`,
      [bot],
    ) as Promise<
      { id: string; contact_id: string; data: Record<string, unknown> }[]
    >;

  beforeAll(async () => {
    ds = await openTestDataSource(LIST_ENTITIES);
    const config = appConfig();
    tokens = new AgentRunTokenService(config);
    lists = new ListToolsService(
      ds,
      new ListDefinitionsService(ds),
      new ListRecordsService(ds),
    );
    gateway = new AgentGatewayService(
      ds,
      config,
      tokens,
      new AgentToolRegistry([]),
      lists,
    );
  });
  afterAll(async () => closeTestDataSource(ds));
  beforeEach(async () => {
    await resetTables(ds);
    bot = await seedChatbot(ds, 'A');
    other = await seedChatbot(ds, 'B');
    await seedLists(ds, bot);
    await seedLists(ds, other);
    await ds.query(
      `UPDATE chatbots SET settings = '{"abilities":{"create_appointments":"do_it","update_appointments":"do_it"}}' WHERE id = $1`,
      [bot],
    );
    alice = await contact('Alice');
    bob = await contact('Bob');
  });

  it('offers the seeded lists’ tools, and only find for person lists when nobody is known', async () => {
    const stored = {
      abilities: { create_appointments: 'do_it', update_appointments: 'do_it' },
    };
    const known = await lists.offeredFor(bot, stored as never, {
      knowsPerson: true,
    });
    expect(known.definitions.map((d) => d.name)).toEqual([
      'find_slots',
      'find_appointments',
      'create_appointments',
      'update_appointments',
      'find_classes',
      'find_bookings',
    ]);
    const unknown = await lists.offeredFor(bot, stored as never, {
      knowsPerson: false,
    });
    expect(unknown.definitions.map((d) => d.name)).toEqual([
      'find_slots',
      'find_classes',
    ]);
  });

  it('finds slots as cited passages, with the total', async () => {
    const found = await call('find_slots', { limit: 2 });
    expect(found.ok).toBe(true);
    expect(found.result!.total).toBe(35);
    expect(found.result!.passages).toHaveLength(2);
    expect(found.result!.passages[0].title).toMatch(/^Slots: /);
    expect(found.result!.passages[0].text).toMatch(
      /^id: [0-9a-f-]{36}\nPractitioner: Dr Rohan/,
    );
    const count = await call('find_slots', { aggregate: 'count' });
    expect(count.result!.aggregate).toEqual({ kind: 'count', value: 35 });
  });

  it('books for the person in the chat, and refuses the same slot for another with alternatives', async () => {
    const [slot] = await freeSlots(1);
    const booked = await call('create_appointments', { slot: slot.record_id });
    expect(booked).toMatchObject({ ok: true, replayed: false });
    expect(booked.result!.passages[0].title).toBe(
      `Appointments: ${slot.record_title}`,
    );
    expect(await appointmentRows()).toEqual([
      expect.objectContaining({ contact_id: alice }),
    ]);

    const taken = await call(
      'create_appointments',
      { slot: slot.record_id },
      { contactId: bob },
    );
    expect(taken.ok).toBe(false);
    expect(taken.error).toBe('unique_taken');
    expect(taken.result!.message).toBe('That slot is already taken.');
    expect(taken.result!.passages).toHaveLength(3);
    expect(taken.result!.passages[0].title).toMatch(/^Slots: /);
    expect(
      taken.result!.passages.map((p: { record_id: string }) => p.record_id),
    ).not.toContain(slot.record_id);
  });

  it('shows each person only their own records, and can’t change anyone else’s', async () => {
    const [a, b] = await freeSlots(2);
    await call('create_appointments', { slot: a.record_id });
    const bobs = await call(
      'create_appointments',
      { slot: b.record_id },
      { contactId: bob },
    );
    const bobsId = bobs.result!.passages[0].record_id;

    const mine = await call('find_appointments', {});
    expect(mine.result!.total).toBe(1);
    expect(mine.result!.passages[0].record_title).toBe(a.record_title);

    const theirs = await call('update_appointments', {
      id: bobsId,
      status: 'cancelled',
    });
    expect(theirs).toMatchObject({ ok: false, error: 'not_found' });
    expect(theirs.result!.message).toBe("That entry doesn't exist any more.");
    expect(
      (await appointmentRows()).find((r) => r.id === bobsId)!.data.status,
    ).toBe('booked');
  });

  it('cancels a booking with update, and a bad transition is refused in plain words', async () => {
    const [slot] = await freeSlots(1);
    const booked = await call('create_appointments', { slot: slot.record_id });
    const id = booked.result!.passages[0].record_id;
    const cancelled = await call('update_appointments', {
      id,
      status: 'cancelled',
    });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.result!.passages[0].text).toContain('Status: cancelled');
    const back = await call('update_appointments', { id, status: 'booked' });
    expect(back).toMatchObject({ ok: false, error: 'transition_not_allowed' });
    expect(back.result!.message).toBe(
      "Appointments can't go from cancelled to booked.",
    );
  });

  it('Preview checks every rule and returns the real result, but saves nothing', async () => {
    const [slot] = await freeSlots(1);
    const preview = await call(
      'create_appointments',
      { slot: slot.record_id },
      { contactId: null, conversationId: 'preview-abc' },
    );
    // Preview knows no person: a stand-in is booked, then everything is rolled back.
    expect(preview.ok).toBe(true);
    expect(preview.result!.preview).toBe(true);
    expect(preview.result!.passages[0].record_title).toBe(slot.record_title);
    expect(await appointmentRows()).toEqual([]);
    expect(
      await ds.query(
        `SELECT 1 FROM chatbot_contacts WHERE display_name = 'Try it'`,
      ),
    ).toEqual([]);

    // A rule still holds in Preview: a slot someone has is refused, with alternatives.
    await call(
      'create_appointments',
      { slot: slot.record_id },
      { contactId: bob },
    );
    const taken = await call(
      'create_appointments',
      { slot: slot.record_id },
      { contactId: null, conversationId: 'preview-xyz' },
    );
    expect(taken).toMatchObject({ ok: false, error: 'unique_taken' });
    expect(taken.result!.passages).toHaveLength(3);
    await ds.query(`DELETE FROM collection_records WHERE contact_id = $1`, [
      bob,
    ]);

    const asPerson = await call(
      'create_appointments',
      { slot: slot.record_id },
      { conversationId: 'preview-def' },
    );
    expect(asPerson.ok).toBe(true);
    expect(asPerson.result!.preview).toBe(true);
    expect(asPerson.result!.passages[0].record_title).toBe(slot.record_title);
    expect(await appointmentRows()).toEqual([]);

    const nobody = await call(
      'find_appointments',
      {},
      {
        contactId: null,
        conversationId: 'preview-ghi',
      },
    );
    expect(nobody.result!.total).toBe(0);
  });

  it('a replayed create returns the stored record and leaves one row', async () => {
    const [slot] = await freeSlots(1);
    const first = await call(
      'create_appointments',
      { slot: slot.record_id },
      { runId: 'run-replay' },
    );
    const again = await call(
      'create_appointments',
      { slot: slot.record_id },
      { runId: 'run-replay' },
    );
    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
    expect(await appointmentRows()).toHaveLength(1);
  });

  it('never reaches another bot’s lists, and Never is refused', async () => {
    await expect(call('find_nothing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Bot B's own slots resolve only under bot B's token; bot A's token can't name them.
    const theirs = await call(
      'find_slots',
      { limit: 1 },
      { chatbotId: other, contactId: null },
    );
    expect(theirs.ok).toBe(true);
    await expect(
      call('create_appointments', { slot: 'x' }, { chatbotId: other }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await ds.query(
      `UPDATE chatbots SET settings = '{"abilities":{"find_slots":"never"}}' WHERE id = $1`,
      [bot],
    );
    await expect(call('find_slots', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
