import { ListConsentService } from '../list-consent.service';
import { memoryRedis } from './agent-tools.fakes';
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
  let consent: ListConsentService;
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
      consent?: string | null;
    } = {},
  ) => {
    const runId = opts.runId ?? `run-6-${++run}`;
    const token = tokens.sign({
      chatbotId: opts.chatbotId ?? bot,
      conversationId: opts.conversationId ?? `conv-${runId}`,
      runId,
      contactId: opts.contactId === undefined ? alice : opts.contactId,
      tools: TOOLS,
      consent: opts.consent ?? null,
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

  /**
   * A write as a conversation makes it (chunk H1): asked first, then said yes to in a later run,
   * whose token carries the stored offer. A refusal before the question comes back as it is.
   */
  const write = async (
    name: string,
    input: Record<string, unknown>,
    opts: Parameters<typeof call>[2] = {},
  ) => {
    const conversationId = opts.conversationId ?? `conv-w-${++run}`;
    const asked = await call(name, input, {
      ...opts,
      conversationId,
      runId: `ask-${++run}`,
    });
    if (asked.error !== 'needs_confirmation') return asked;
    const offer = await consent.current(opts.chatbotId ?? bot, conversationId);
    return call(name, input, { ...opts, conversationId, consent: offer!.id });
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
    consent = new ListConsentService(memoryRedis() as never);
    lists = new ListToolsService(
      ds,
      new ListDefinitionsService(ds),
      new ListRecordsService(ds),
      consent,
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

  it('finds exactly the time asked for with <key>_at, in any written form of it', async () => {
    const [row] = await ds.query(
      `SELECT r.id, r.data->>'starts_at' AS starts_at FROM collection_records r
         JOIN collections c ON c.id = r.collection_id
        WHERE c.chatbot_id = $1 AND c.key = 'slots' ORDER BY r.data->>'starts_at' LIMIT 1 OFFSET 7`,
      [bot],
    );
    const utc = new Date(row.starts_at).toISOString(); // the same instant, written in UTC
    for (const at of [row.starts_at, utc]) {
      const found = await call('find_slots', { starts_at_at: at });
      expect(found.result!.total).toBe(1);
      expect(found.result!.passages[0].record_id).toBe(row.id);
    }
  });

  it('offers the nearest times when none is at the time asked for, closest first in time order', async () => {
    const rows: { id: string; starts_at: string }[] = await ds.query(
      `SELECT r.id, r.data->>'starts_at' AS starts_at FROM collection_records r
         JOIN collections c ON c.id = r.collection_id
        WHERE c.chatbot_id = $1 AND c.key = 'slots' AND r.deleted_at IS NULL
          AND (r.data->>'starts_at')::timestamptz > now()
        ORDER BY (r.data->>'starts_at')::timestamptz`,
      [bot],
    );
    // Between two slots, a minute after the 5th: nothing there, so the nearest three.
    const asked = new Date(new Date(rows[4].starts_at).getTime() + 60_000);
    const found = await call('find_slots', {
      starts_at_at: asked.toISOString(),
      practitioner_contains: 'window',
    });
    expect(found.ok).toBe(true);
    expect(found.result!.total).toBe(0);
    expect(found.result!.nearest).toBe(true);
    const ids = (found.result!.passages as { record_id: string }[]).map(
      (p) => p.record_id,
    );
    expect(ids).toHaveLength(3);
    expect(ids).toContain(rows[4].id);
    const at = (id: string) =>
      new Date(rows.find((r) => r.id === id)!.starts_at).getTime();
    expect(ids.map(at)).toEqual([...ids.map(at)].sort((a, b) => a - b));

    // Nothing near then fits the other details: the nearest by time alone, marked so.
    const big = await call('find_slots', {
      starts_at_at: asked.toISOString(),
      duration_from: '600',
    });
    expect(big.result!.total).toBe(0);
    expect(big.result!.nearest).toBe('other_details');
    expect(big.result!.passages).toHaveLength(3);

    // Only a number detail is read as "at least" (seats); a duration range stays exact.
    const exact = await call('find_slots', {
      starts_at_at: rows[4].starts_at,
      duration_from: '40',
      duration_to: '40',
    });
    expect(exact.result!.total).toBe(0);

    // A find with no time, or with matches, offers nothing extra.
    const plain = await call('find_slots', { starts_at_at: rows[4].starts_at });
    expect(plain.result!.nearest).toBeUndefined();
    const far = await call('find_slots', {
      starts_at_at: '2030-01-01T10:00:00Z',
    });
    expect(far.result!.passages).toEqual([]);
  });

  it('books for the person in the chat, and refuses the same slot for another with alternatives', async () => {
    const [slot] = await freeSlots(1);
    const booked = await write('create_appointments', { slot: slot.record_id });
    expect(booked).toMatchObject({ ok: true, replayed: false });
    expect(booked.result!.passages[0].title).toBe(
      `Appointments: ${slot.record_title}`,
    );
    expect(await appointmentRows()).toEqual([
      expect.objectContaining({ contact_id: alice }),
    ]);

    const taken = await write(
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
    await write('create_appointments', { slot: a.record_id });
    const bobs = await write(
      'create_appointments',
      { slot: b.record_id },
      { contactId: bob },
    );
    const bobsId = bobs.result!.passages[0].record_id;

    const mine = await call('find_appointments', {});
    expect(mine.result!.total).toBe(1);
    expect(mine.result!.passages[0].record_title).toBe(a.record_title);

    const theirs = await write('update_appointments', {
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
    const booked = await write('create_appointments', { slot: slot.record_id });
    const id = booked.result!.passages[0].record_id;
    const cancelled = await write('update_appointments', {
      id,
      status: 'cancelled',
    });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.result!.passages[0].text).toContain('Status: cancelled');
    const back = await write('update_appointments', { id, status: 'booked' });
    expect(back).toMatchObject({ ok: false, error: 'transition_not_allowed' });
    expect(back.result!.message).toBe(
      "Appointments can't go from cancelled to booked.",
    );
  });

  it('Preview checks every rule and returns the real result, but saves nothing', async () => {
    const [slot] = await freeSlots(1);
    const preview = await write(
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
    await write(
      'create_appointments',
      { slot: slot.record_id },
      { contactId: bob },
    );
    const taken = await write(
      'create_appointments',
      { slot: slot.record_id },
      { contactId: null, conversationId: 'preview-xyz' },
    );
    expect(taken).toMatchObject({ ok: false, error: 'unique_taken' });
    expect(taken.result!.passages).toHaveLength(3);
    await ds.query(`DELETE FROM collection_records WHERE contact_id = $1`, [
      bob,
    ]);

    const asPerson = await write(
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

  describe('consent (chunk H1)', () => {
    it('saves nothing without a yes, and asks a question naming the slot and the person', async () => {
      const [slot] = await freeSlots(1);
      const asked = await call(
        'create_appointments',
        { slot: slot.record_id },
        { conversationId: 'conv-consent-1' },
      );
      expect(asked).toMatchObject({ ok: false, error: 'needs_confirmation' });
      expect(asked.result!.question).toMatch(/^Shall I book .+\?$/);
      expect(asked.result!.question).toContain(slot.record_title);
      expect(asked.result!.question).toContain('for Alice');
      expect(await appointmentRows()).toEqual([]);
    });

    it('a yes covers only the entry it was asked about', async () => {
      const [a, b] = await freeSlots(2);
      const conversationId = 'conv-consent-2';
      await call(
        'create_appointments',
        { slot: a.record_id },
        { conversationId },
      );
      const offer = await consent.current(bot, conversationId);
      const other = await call(
        'create_appointments',
        { slot: b.record_id },
        { conversationId, consent: offer!.id },
      );
      expect(other).toMatchObject({ ok: false, error: 'needs_confirmation' });
      expect(other.result!.question).toContain(b.record_title);
      expect(await appointmentRows()).toEqual([]);
    });

    it('a yes must come in a later run than the question', async () => {
      const [slot] = await freeSlots(1);
      const conversationId = 'conv-consent-3';
      const runId = 'run-same-turn';
      await call(
        'create_appointments',
        { slot: slot.record_id },
        { conversationId, runId },
      );
      const offer = await consent.current(bot, conversationId);
      const sameRun = await call(
        'create_appointments',
        { slot: slot.record_id },
        { conversationId, runId, step: 1, consent: offer!.id },
      );
      expect(sameRun).toMatchObject({ ok: false, error: 'needs_confirmation' });
      expect(await appointmentRows()).toEqual([]);
    });

    it('a token without the offer, or naming another, writes nothing', async () => {
      const [slot] = await freeSlots(1);
      const conversationId = 'conv-consent-4';
      await call(
        'create_appointments',
        { slot: slot.record_id },
        { conversationId },
      );
      const wrong = await call(
        'create_appointments',
        { slot: slot.record_id },
        { conversationId, consent: 'not-the-offer' },
      );
      expect(wrong).toMatchObject({ ok: false, error: 'needs_confirmation' });
      expect(await appointmentRows()).toEqual([]);
    });

    it('a move asks its own question, naming the entry it moves; a cancel says cancel', async () => {
      const [a, b] = await freeSlots(2);
      const booked = await write('create_appointments', { slot: a.record_id });
      const id = booked.result!.passages[0].record_id;
      const move = await call(
        'update_appointments',
        { id, slot: b.record_id },
        { conversationId: 'conv-consent-5' },
      );
      expect(move).toMatchObject({ ok: false, error: 'needs_confirmation' });
      expect(move.result!.question).toMatch(/^Shall I (move|change) your /);
      expect(move.result!.question).toContain(a.record_title);
      expect(move.result!.question).toContain(b.record_title);
      const rows = await appointmentRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].data.slot).toBe(a.record_id);

      const cancel = await call(
        'update_appointments',
        { id, status: 'cancelled' },
        { conversationId: 'conv-consent-6' },
      );
      expect(cancel.result!.question).toMatch(/^Shall I cancel your /);
      expect(cancel.result!.question).toContain(a.record_title);

      const moved = await write('update_appointments', {
        id,
        slot: b.record_id,
      });
      expect(moved.ok).toBe(true);
      expect(moved.result!.before.record_title).toBe(a.record_title);
      expect(moved.result!.passages[0].record_title).toBe(b.record_title);
    });

    it('a run ally-be has stopped waiting for writes nothing, even with a yes', async () => {
      const [slot] = await freeSlots(1);
      const conversationId = 'conv-consent-8';
      await call(
        'create_appointments',
        { slot: slot.record_id },
        { conversationId },
      );
      const offer = await consent.current(bot, conversationId);
      await consent.endRun('run-late');
      const late = await call(
        'create_appointments',
        { slot: slot.record_id },
        { conversationId, consent: offer!.id, runId: 'run-late' },
      );
      expect(late).toMatchObject({ ok: false, error: 'run_ended' });
      expect(await appointmentRows()).toEqual([]);
    });

    it('a slot someone has is refused before anything is asked', async () => {
      const [slot] = await freeSlots(1);
      await write(
        'create_appointments',
        { slot: slot.record_id },
        { contactId: bob },
      );
      const conversationId = 'conv-consent-7';
      const taken = await call(
        'create_appointments',
        { slot: slot.record_id },
        { conversationId },
      );
      expect(taken).toMatchObject({ ok: false, error: 'unique_taken' });
      expect(await consent.current(bot, conversationId)).toBeNull();
    });
  });

  it('a replayed create returns the stored record and leaves one row', async () => {
    const [slot] = await freeSlots(1);
    const first = await write(
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
      write('create_appointments', { slot: 'x' }, { chatbotId: other }),
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
