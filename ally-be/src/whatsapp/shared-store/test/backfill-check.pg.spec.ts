import { DataSource } from 'typeorm';
import {
  BackfillCursor,
  backfillSharedStore,
} from '../wa-shared-store.backfill';
import { checkSharedStore } from '../wa-shared-store.check';
import { contactIdsFor, PLACEHOLDER_ID } from '../wa-shared-store.mapper';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
  seedWhatsAppThread,
} from './shared-store.pg';

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 9, 0, 0));
const at = (d: number, s: number) => new Date(day(d).getTime() + s * 1000);

describePg('Shared store backfill and consistency check (Postgres)', () => {
  let dataSource: DataSource;
  let botA: string;
  let botB: string;
  let seeded: {
    moved: { contactId: string; threadA: string; threadB: string };
    twoNumbers: { firstContact: string; secondContact: string };
    messages: number;
  };

  /** Every shared row, for comparing two runs. */
  const snapshot = async () => ({
    contacts: await dataSource.query(
      `SELECT id, chatbot_id FROM chatbot_contacts ORDER BY id`,
    ),
    identities: await dataSource.query(
      `SELECT contact_id, chatbot_id, channel, external_id, verified
         FROM chatbot_contact_identities ORDER BY contact_id, chatbot_id`,
    ),
    conversations: await dataSource.query(
      `SELECT id, chatbot_id, contact_id, channel, started_at, last_message_at
         FROM chatbot_conversations ORDER BY id`,
    ),
    messages: await dataSource.query(
      `SELECT id, conversation_id, direction, role, text, status, provider_message_id, "createdAt"
         FROM chatbot_messages ORDER BY id`,
    ),
  });

  beforeAll(async () => {
    dataSource = await openTestDataSource();
  });
  afterAll(async () => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    botA = await seedChatbot(dataSource, 'A');
    botB = await seedChatbot(dataSource, 'B');

    // A number that wrote to bot A, then (after the number moved) to bot B: a split.
    const onA = await seedWhatsAppThread(dataSource, {
      chatbotId: botA,
      phone: '919800000001',
      messages: [0, 1, 2].map((s) => ({ body: `a${s}`, at: at(1, s) })),
    });
    const onB = await seedWhatsAppThread(dataSource, {
      chatbotId: botB,
      contactId: onA.contactId,
      messages: [0, 1].map((s) => ({ body: `b${s}`, at: at(2, s) })),
    });

    // One person writing to two numbers that both answer as bot A: a merge.
    const first = await seedWhatsAppThread(dataSource, {
      chatbotId: botA,
      phone: '919800000002',
      messages: [{ body: 'first number', at: at(3, 0) }],
    });
    const [second] = await dataSource.query(
      `INSERT INTO wa_contacts (phone_e164, phone_last4, business_number_id, first_seen_at, last_seen_at)
       VALUES ('919800000002', '0002', gen_random_uuid(), $1, $1) RETURNING id`,
      [at(4, 0)],
    );
    await seedWhatsAppThread(dataSource, {
      chatbotId: botA,
      contactId: second.id,
      messages: [{ body: 'second number', at: at(4, 0) }],
    });

    // A thread with no bot, and an inbound row discarded before its contact was known.
    const orphan = await seedWhatsAppThread(dataSource, {
      chatbotId: botA,
      phone: '919800000003',
      messages: [{ body: 'no bot', at: at(5, 0) }],
    });
    await dataSource.query(
      `UPDATE wa_conversations SET chatbot_id = NULL WHERE id = $1`,
      [orphan.conversationId],
    );
    await dataSource.query(
      `INSERT INTO wa_messages (conversation_id, contact_id, direction, provider_message_id, body, status, "createdAt")
       VALUES ($1, $1, 'inbound', 'wamid.discarded', 'kill switch', 'discarded', $2)`,
      [PLACEHOLDER_ID, at(6, 0)],
    );

    seeded = {
      moved: {
        contactId: onA.contactId,
        threadA: onA.conversationId,
        threadB: onB.conversationId,
      },
      twoNumbers: {
        firstContact: first.contactId,
        secondContact: second.id,
      },
      messages: 7,
    };
  });

  const check = () =>
    checkSharedStore(dataSource, { sample: 50, settleMinutes: 0 });

  it('copies everything with a thread and a bot, reusing the wa ids', async () => {
    const report = await backfillSharedStore(dataSource, { batchSize: 2 });

    expect(report).toMatchObject({
      conversations: 4,
      messages: seeded.messages,
      skippedNoBot: 1,
      skippedNoThread: 2, // the discarded row, and the message in the thread with no bot
      cursor: { phase: 'done' },
    });
    const [kept, derived] = contactIdsFor(seeded.moved.contactId, botB);
    expect(report.splits).toEqual([
      {
        waContactId: seeded.moved.contactId,
        chatbotId: botB,
        contactId: derived,
      },
    ]);
    expect(report.merges).toEqual([
      {
        waContactId: seeded.twoNumbers.secondContact,
        chatbotId: botA,
        contactId: seeded.twoNumbers.firstContact,
      },
    ]);

    const threads = await dataSource.query(
      `SELECT id, contact_id FROM chatbot_conversations`,
    );
    const contactOf = new Map(threads.map((t: any) => [t.id, t.contact_id]));
    expect(contactOf.get(seeded.moved.threadA)).toBe(kept);
    expect(contactOf.get(seeded.moved.threadB)).toBe(derived);

    const waIds = await dataSource.query(
      `SELECT m.id FROM wa_messages m JOIN wa_conversations c ON c.id = m.conversation_id
        WHERE c.chatbot_id IS NOT NULL ORDER BY m.id`,
    );
    const sharedIds = await dataSource.query(
      `SELECT id FROM chatbot_messages ORDER BY id`,
    );
    expect(sharedIds).toEqual(waIds);
  });

  it('a second run changes nothing', async () => {
    await backfillSharedStore(dataSource);
    const once = await snapshot();
    await backfillSharedStore(dataSource);
    expect(await snapshot()).toEqual(once);
  });

  it('resumes from its cursor after a crash, and ends as a full run would', async () => {
    let saved: BackfillCursor | undefined;
    let batches = 0;
    await expect(
      backfillSharedStore(dataSource, {
        batchSize: 2,
        onBatch: (cursor) => {
          saved = cursor;
          if (++batches === 4) throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    expect(saved?.phase).toBe('messages');

    await backfillSharedStore(dataSource, { batchSize: 2, from: saved });
    const resumed = await snapshot();

    await dataSource.query(
      `TRUNCATE chatbot_messages, chatbot_conversations, chatbot_contact_identities, chatbot_contacts`,
    );
    await backfillSharedStore(dataSource);
    expect(resumed).toEqual(await snapshot());
    expect(resumed.messages).toHaveLength(seeded.messages);
  });

  it('repairs a row the dual-write left behind or that changed since', async () => {
    await backfillSharedStore(dataSource);
    await dataSource.query(
      `UPDATE wa_messages SET status = 'failed', error_message = 'late failure'
        WHERE body = 'a1'`,
    );
    await dataSource.query(`DELETE FROM chatbot_messages WHERE text = 'b0'`);
    expect((await check()).mismatches).not.toEqual([]);

    await backfillSharedStore(dataSource);
    expect((await check()).mismatches).toEqual([]);
  });

  it('a dry run writes nothing', async () => {
    const report = await backfillSharedStore(dataSource, { dryRun: true });
    expect(report.conversations).toBe(4);
    expect(report.messages).toBe(seeded.messages);
    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM chatbot_contacts`,
    );
    expect(count).toBe(0);
  });

  describe('the consistency check', () => {
    beforeEach(async () => {
      await backfillSharedStore(dataSource);
    });

    it('passes on a backfilled store', async () => {
      const report = await check();
      expect(report.mismatches).toEqual([]);
      expect(report.sampledThreads).toBe(4);
      expect(report.comparedMessages).toBe(seeded.messages);
    });

    it('finds a changed message', async () => {
      await dataSource.query(
        `UPDATE chatbot_messages SET text = 'tampered' WHERE text = 'a2'`,
      );
      const { mismatches } = await check();
      expect(mismatches).toEqual([
        expect.stringMatching(/^message .* body differs$/),
      ]);
    });

    it('finds a missing message', async () => {
      await dataSource.query(`DELETE FROM chatbot_messages WHERE text = 'a0'`);
      const { mismatches } = await check();
      expect(mismatches).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/wa message\(s\), \d+ shared$/),
          expect.stringMatching(/^message .*: missing$/),
        ]),
      );
    });

    it('finds a missing identity', async () => {
      await dataSource.query(
        `DELETE FROM chatbot_contact_identities WHERE chatbot_id = $1`,
        [botB],
      );
      const { mismatches } = await check();
      expect(mismatches).toEqual([
        `thread ${seeded.moved.threadB}: its contact has no whatsapp identity on this bot`,
      ]);
    });

    it('finds a shared row with no wa row behind it', async () => {
      await dataSource.query(
        `INSERT INTO chatbot_messages (conversation_id, channel, direction, role, text)
         VALUES ($1, 'whatsapp', 'inbound', 'user', 'invented')`,
        [seeded.moved.threadA],
      );
      const { mismatches } = await check();
      expect(mismatches).toEqual(
        expect.arrayContaining(['1 shared message(s) with no wa_messages row']),
      );
    });
  });
});
