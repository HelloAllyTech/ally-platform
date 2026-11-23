import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../../whatsapp/shared-store/test/shared-store.pg';
import { AssistantRetentionService } from '../assistant-retention.service';
import { CustomerErasureService } from '../customer-erasure.service';
import { MemoryConsentService } from '../memory-consent.service';
import { ERASED_TEXT } from '../erased';
import { ChatbotSharingService } from '../../sharing/chatbot-sharing.service';
import { QuickReplyCopyService } from '../../quick-replies/quick-reply-copy.service';
import { runStage5Migration } from '../stage5-migration';

/**
 * Stage 5 against real Postgres (plan section 6, stage 5): the first retention sweep, erase with
 * a flagged conversation and on a shared WhatsApp number, consent states, copy charging the
 * copying builder, the curated pool, and the migration's idempotence. Runs only with
 * CHATBOT_STORE_TEST_DB (a `_test` database migrated to the latest schema).
 */
const DAY = 86_400_000;
const NOW = new Date('2026-12-01T00:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describePg('Assistants stage 5: customer data (Postgres)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });
  afterAll(async () => closeTestDataSource(ds));
  beforeEach(async () => {
    await resetTables(ds);
    await ds.query(
      `TRUNCATE memory_entries, memory_consents, tool_runs, kb_documents, chatbot_documents,
                wa_keyword_templates, alert_outbox, collections, chatbot_members CASCADE`,
    );
    await ds.query(
      `DELETE FROM global_settings WHERE name IN ('crisis_flag_backfill', 'assistant_retention_sweep', 'memory_consent_cutover', 'quick_reply_copy')`,
    );
  });

  async function chat(
    chatbotId: string,
    phone: string,
    opts: {
      at: Date;
      retainUntil?: Date | null;
      text?: string;
      contactId?: string;
    },
  ) {
    const contact = opts.contactId
      ? { id: opts.contactId }
      : (
          await ds.query(
            `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, 'Asha') RETURNING id`,
            [chatbotId],
          )
        )[0];
    if (!opts.contactId) {
      await ds.query(
        `INSERT INTO chatbot_contact_identities (contact_id, chatbot_id, channel, external_id, verified)
         VALUES ($1, $2, 'whatsapp', $3, true)`,
        [contact.id, chatbotId, phone],
      );
    }
    const [conv] = await ds.query(
      `INSERT INTO chatbot_conversations (chatbot_id, contact_id, channel, status, started_at, last_message_at, retain_until, summary)
       VALUES ($1, $2, 'whatsapp', 'closed', $3, $3, $4, 'they asked about fees') RETURNING id`,
      [chatbotId, contact.id, opts.at, opts.retainUntil ?? null],
    );
    const [msg] = await ds.query(
      `INSERT INTO chatbot_messages (conversation_id, channel, direction, role, text, status, "createdAt")
       VALUES ($1, 'whatsapp', 'inbound', 'user', $2, 'received', $3) RETURNING id`,
      [conv.id, opts.text ?? 'my fee receipt number is 123', opts.at],
    );
    await ds.query(
      `INSERT INTO memory_entries (chatbot_id, contact_id, section, text, source_message_id, source_kind, status, said_at)
       VALUES ($1, $2, 'context', 'Has a fee question', $3, 'person', 'active', $4)`,
      [chatbotId, contact.id, msg.id, opts.at],
    );
    await ds.query(
      `INSERT INTO tool_runs (chatbot_id, conversation_id, run_id, step, tool, input, status, "createdAt")
       VALUES ($1, $2, $2, 1, 'lookup', '{"q":"fees"}', 'ok', $3)`,
      [chatbotId, conv.id, opts.at],
    );
    return {
      contactId: contact.id,
      conversationId: conv.id,
      messageId: msg.id,
    };
  }

  const textOf = async (conversationId: string) =>
    (
      await ds.query(
        `SELECT text FROM chatbot_messages WHERE conversation_id = $1`,
        [conversationId],
      )
    )[0].text as string;

  describe('retention sweep (D11)', () => {
    const backfillDone = () =>
      ds.query(
        `INSERT INTO global_settings (name, value, "createdBy", "updatedBy") VALUES ('crisis_flag_backfill', '{"doneAt":"2026-11-30T00:00:00Z"}', 0, 0)`,
      );

    it('refuses a real sweep until the crisis backfill has finished, but a dry run still counts', async () => {
      const bot = await seedChatbot(ds);
      const old = await chat(bot, '919800000001', { at: ago(120) });
      const service = new AssistantRetentionService(ds);
      const real = await service.run({ now: NOW });
      expect(real.blocked).toBe('crisis_backfill_not_done');
      expect(await textOf(old.conversationId)).not.toBe(ERASED_TEXT);
      const dry = await service.run({ dryRun: true, now: NOW });
      expect(dry.counts.chatbot_messages).toBe(1);
      expect(dry.counts.memory_entries).toBe(1);
      expect(await textOf(old.conversationId)).not.toBe(ERASED_TEXT);
    });

    it('first sweep blanks older unflagged conversations in every store, keeps flagged and recent ones, and is idempotent', async () => {
      await backfillDone();
      const bot = await seedChatbot(ds);
      const old = await chat(bot, '919800000001', { at: ago(120) });
      const recent = await chat(bot, '919800000002', { at: ago(10) });
      const flagged = await chat(bot, '919800000003', {
        at: ago(120),
        retainUntil: new Date(NOW.getTime() + 200 * DAY),
      });
      const expired = await chat(bot, '919800000004', {
        at: ago(400),
        retainUntil: ago(5),
      });
      const service = new AssistantRetentionService(ds);
      const report = await service.run({ now: NOW });
      expect(report.blocked).toBeNull();
      expect(report.exemptConversations).toBe(1);
      expect(report.counts.chatbot_messages).toBe(2);
      expect(await textOf(old.conversationId)).toBe(ERASED_TEXT);
      expect(await textOf(expired.conversationId)).toBe(ERASED_TEXT);
      expect(await textOf(recent.conversationId)).not.toBe(ERASED_TEXT);
      expect(await textOf(flagged.conversationId)).not.toBe(ERASED_TEXT);
      const memory = await ds.query(
        `SELECT contact_id FROM memory_entries ORDER BY contact_id`,
      );
      expect(
        memory.map((m: { contact_id: string }) => m.contact_id).sort(),
      ).toEqual([recent.contactId, flagged.contactId].sort());
      const [summary] = await ds.query(
        `SELECT summary FROM chatbot_conversations WHERE id = $1`,
        [old.conversationId],
      );
      expect(summary.summary).toBeNull();
      const [identity] = await ds.query(
        `SELECT external_id FROM chatbot_contact_identities WHERE contact_id = $1`,
        [old.contactId],
      );
      expect(identity.external_id).toMatch(/^erased:/);
      const again = await service.run({ now: NOW });
      expect(Object.values(again.counts).every((n) => n === 0)).toBe(true);
    });

    it("uses each chatbot's own days, and 90 for a WhatsApp thread with no chatbot", async () => {
      await backfillDone();
      const short = await seedChatbot(ds, 'short');
      await ds.query(
        `UPDATE chatbots SET settings = '{"retentionDays": 30}' WHERE id = $1`,
        [short],
      );
      const long = await seedChatbot(ds, 'long');
      const a = await chat(short, '919800000011', { at: ago(45) });
      const b = await chat(long, '919800000012', { at: ago(45) });
      const [waContact] = await ds.query(
        `INSERT INTO wa_contacts (phone_e164, phone_last4, first_seen_at, last_seen_at) VALUES ('919800000013', '0013', $1, $1) RETURNING id`,
        [ago(100)],
      );
      const [orphan] = await ds.query(
        `INSERT INTO wa_conversations (contact_id, started_at, last_message_at) VALUES ($1, $2, $2) RETURNING id`,
        [waContact.id, ago(100)],
      );
      await ds.query(
        `INSERT INTO wa_messages (conversation_id, contact_id, direction, body, status, "createdAt") VALUES ($1, $2, 'inbound', 'hello', 'received', $3)`,
        [orphan.id, waContact.id, ago(100)],
      );
      await new AssistantRetentionService(ds).run({ now: NOW });
      expect(await textOf(a.conversationId)).toBe(ERASED_TEXT);
      expect(await textOf(b.conversationId)).not.toBe(ERASED_TEXT);
      const [wa] = await ds.query(
        `SELECT body FROM wa_messages WHERE conversation_id = $1`,
        [orphan.id],
      );
      expect(wa.body).toBe(ERASED_TEXT);
    });

    it('is switched off by ASSISTANT_RETENTION_SWEEP_ENABLED=false', async () => {
      await backfillDone();
      const service = new AssistantRetentionService(ds, {
        get: () => 'false',
      } as never);
      expect((await service.run({ now: NOW })).blocked).toBe('switched_off');
    });
  });

  describe('erase in chat (R5)', () => {
    it('erases conversations, memory and name, keeps a flagged conversation, list records and the identity', async () => {
      const bot = await seedChatbot(ds);
      const phone = '919800000021';
      const plain = await chat(bot, phone, { at: ago(3) });
      const flagged = await chat(bot, phone, {
        at: ago(2),
        retainUntil: new Date(NOW.getTime() + 300 * DAY),
        contactId: plain.contactId,
      });
      // A list record that points at the person (owner's data).
      const [collection] = await ds.query(
        `INSERT INTO collections (chatbot_id, key, name) VALUES ($1, 'bookings', 'Bookings') RETURNING id`,
        [bot],
      );
      await ds.query(
        `INSERT INTO collection_records (collection_id, chatbot_id, contact_id, data) VALUES ($1, $2, $3, '{}')`,
        [collection.id, bot, plain.contactId],
      );
      const service = new CustomerErasureService(ds);
      const result = await service.eraseEndPerson(bot, { phone }, NOW);
      expect(result.found).toBe(true);
      expect(result.keptConversationIds).toEqual([flagged.conversationId]);
      expect(result.kept.map((k) => k.what)).toEqual([
        'flagged_conversations',
        'list_records',
        'sign_in',
      ]);
      expect(await textOf(plain.conversationId)).toBe(ERASED_TEXT);
      expect(await textOf(flagged.conversationId)).not.toBe(ERASED_TEXT);
      const memory = await ds.query(
        `SELECT source_message_id FROM memory_entries`,
      );
      expect(memory).toEqual([{ source_message_id: flagged.messageId }]);
      const [records] = await ds.query(
        `SELECT count(*)::int AS n FROM collection_records`,
      );
      expect(records.n).toBe(1);
      const ids = await ds.query(
        `SELECT external_id FROM chatbot_contact_identities WHERE chatbot_id = $1`,
        [bot],
      );
      expect(
        ids.every((r: { external_id: string }) => r.external_id === phone),
      ).toBe(true);
      // The name stays with the flagged conversation it belongs to.
      const [name] = await ds.query(
        `SELECT display_name FROM chatbot_contacts WHERE id = $1`,
        [plain.contactId],
      );
      expect(name.display_name).toBe('Asha');
      const tools = await ds.query(`SELECT conversation_id FROM tool_runs`);
      expect(tools).toEqual([{ conversation_id: flagged.conversationId }]);
    });

    it('on a WhatsApp number shared by two chatbots, erases only the asking chatbot’s data', async () => {
      const a = await seedChatbot(ds, 'A');
      const b = await seedChatbot(ds, 'B');
      const phone = '919800000031';
      const onA = await chat(a, phone, { at: ago(1) });
      const onB = await chat(b, phone, { at: ago(1) });
      await new CustomerErasureService(ds).eraseEndPerson(a, { phone }, NOW);
      expect(await textOf(onA.conversationId)).toBe(ERASED_TEXT);
      expect(await textOf(onB.conversationId)).not.toBe(ERASED_TEXT);
    });

    it('stores and clears the two-step confirm on the conversation', async () => {
      const bot = await seedChatbot(ds);
      const c = await chat(bot, '919800000041', { at: ago(1) });
      const service = new CustomerErasureService(ds);
      await service.setPending(c.conversationId, {
        askedAt: NOW.toISOString(),
      });
      expect(await service.pendingFor(c.conversationId)).toEqual({
        askedAt: NOW.toISOString(),
      });
      await service.setPending(c.conversationId, null);
      expect(await service.pendingFor(c.conversationId)).toBeNull();
    });
  });

  describe('memory consent (D7)', () => {
    it('moves unasked → asked → granted, asks only once, and a no deletes their lines', async () => {
      const bot = await seedChatbot(ds);
      const c = await chat(bot, '919800000051', { at: ago(1) });
      const consent = new MemoryConsentService(ds);
      expect((await consent.stateFor(bot, c.contactId)).state).toBe('unasked');
      const asked = await consent.ask(bot, c.contactId, 'en');
      // Unknown audience age: the young-people wording.
      expect(asked?.wordingVersion).toBe('memory-consent-young-v1');
      expect((await consent.stateFor(bot, c.contactId)).state).toBe('asked');
      expect(await consent.isGranted(bot, c.contactId)).toBe(false);
      await consent.record(bot, c.contactId, 'granted', asked!.wordingVersion);
      expect(await consent.isGranted(bot, c.contactId)).toBe(true);
      expect(await consent.ask(bot, c.contactId, 'en')).toBeNull();
      await consent.record(bot, c.contactId, 'declined', asked!.wordingVersion);
      const [lines] = await ds.query(
        `SELECT count(*)::int AS n FROM memory_entries WHERE contact_id = $1`,
        [c.contactId],
      );
      expect(lines.n).toBe(0);
    });

    it('cutover deletes memory from before consent once, and never memory stored after it', async () => {
      const bot = await seedChatbot(ds);
      await chat(bot, '919800000061', { at: ago(2) });
      const consent = new MemoryConsentService(ds);
      const cutoverAt = new Date(Date.now() - 60_000);
      await ds.query(`UPDATE memory_entries SET "createdAt" = $1`, [
        new Date(Date.now() - 2 * DAY),
      ]);
      const dry = await consent.cutover({ dryRun: true, now: cutoverAt });
      expect(dry.entries).toBe(1);
      const first = await consent.cutover({ now: cutoverAt });
      expect(first.entries).toBe(1);
      // A line written with consent after the cutover.
      await chat(bot, '919800000062', { at: new Date() });
      await ds.query(
        `UPDATE memory_entries SET "createdAt" = now() + interval '1 minute'`,
      );
      const second = await consent.cutover({ now: new Date() });
      expect(second.entries).toBe(0);
      expect(second.alreadyDone).toBe(true);
    });
  });

  describe('copy, not share', () => {
    const access = (staff = false) =>
      ({
        assert: jest.fn().mockResolvedValue({}),
        assertCanCreate: jest.fn().mockResolvedValue(undefined),
        isPlatformAdmin: jest.fn().mockResolvedValue(staff),
        assertPlatformAdmin: jest.fn().mockResolvedValue(undefined),
      }) as never;
    const producer = () => ({
      enqueue: jest.fn().mockResolvedValue(undefined),
    });

    async function ownDocument(chatbotId: string, createdBy: number) {
      const [doc] = await ds.query(
        `INSERT INTO kb_documents (title, source_type, raw_text, tags, status, content_hash, created_by, corpus, owner_chatbot_id, is_global)
         VALUES ('Fees', 'paste', 'Fees are 500 rupees', '{}', 'indexed', 'h', $2, 'whatsapp_qa', $1, false) RETURNING id`,
        [chatbotId, createdBy],
      );
      await ds.query(
        `INSERT INTO chatbot_documents (chatbot_id, document_id) VALUES ($1, $2)`,
        [chatbotId, doc.id],
      );
      return doc.id as string;
    }

    it('duplicate copies settings and documents, never conversations or members, and the copies are charged to the copying builder', async () => {
      const source = await seedChatbot(ds, 'Clinic');
      await ds.query(
        `UPDATE chatbots SET settings = '{"retentionDays": 30}', persona = '{"displayName":"Asha"}' WHERE id = $1`,
        [source],
      );
      await ds.query(
        `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles) VALUES ($1, 1, 'owner', ARRAY['owner']), ($1, 2, 'editor', ARRAY['editor'])`,
        [source],
      );
      const original = await ownDocument(source, 1);
      await chat(source, '919800000071', { at: ago(1) });
      const queue = producer();
      const sharing = new ChatbotSharingService(ds, access(), queue as never);
      const result = await sharing.duplicate(source, 2);
      const [copy] = await ds.query(`SELECT * FROM chatbots WHERE id = $1`, [
        result.chatbotId,
      ]);
      expect(copy.status).toBe('draft');
      expect(copy.settings).toEqual({ retentionDays: 30 });
      expect(copy.copied_from_chatbot_id).toBe(source);
      const members = await ds.query(
        `SELECT user_id, roles FROM chatbot_members WHERE chatbot_id = $1`,
        [result.chatbotId],
      );
      expect(members).toEqual([{ user_id: 2, roles: ['owner'] }]);
      const [convs] = await ds.query(
        `SELECT count(*)::int AS n FROM chatbot_conversations WHERE chatbot_id = $1`,
        [result.chatbotId],
      );
      expect(convs.n).toBe(0);
      const [doc] = await ds.query(
        `SELECT created_by, owner_chatbot_id, copied_from_document_id, status FROM kb_documents WHERE id = $1`,
        [result.documentIds[0]],
      );
      // The ingest charges `created_by`: the copying builder, not the original's owner.
      expect(doc).toEqual({
        created_by: 2,
        owner_chatbot_id: result.chatbotId,
        copied_from_document_id: original,
        status: 'pending',
      });
      expect(queue.enqueue).toHaveBeenCalledWith({
        documentId: result.documentIds[0],
        action: 'reindex',
      });
    });

    it('copy-from skips a document already copied, and the curated pool copies on choice', async () => {
      const a = await seedChatbot(ds, 'A');
      const b = await seedChatbot(ds, 'B');
      await ownDocument(a, 1);
      const sharing = new ChatbotSharingService(
        ds,
        access(),
        producer() as never,
      );
      const first = await sharing.copyKnowledgeFrom(b, a, null, 3);
      expect(first.documentIds).toHaveLength(1);
      const again = await sharing.copyKnowledgeFrom(b, a, null, 3);
      expect(again).toEqual({ documentIds: [], skipped: 1 });

      const [pool] = await ds.query(
        `INSERT INTO kb_documents (title, source_type, raw_text, tags, status, content_hash, created_by, corpus, is_global, curated)
         VALUES ('First aid', 'paste', 'Call for help', '{}', 'indexed', 'h', 1, 'whatsapp_qa', false, true) RETURNING id`,
      );
      expect((await sharing.listCurated()).map((d) => d.id)).toEqual([pool.id]);
      const added = await sharing.addFromPool(b, pool.id, 3);
      const [copy] = await ds.query(
        `SELECT owner_chatbot_id, curated, created_by FROM kb_documents WHERE id = $1`,
        [added.documentIds[0]],
      );
      expect(copy).toEqual({
        owner_chatbot_id: b,
        curated: false,
        created_by: 3,
      });
    });
  });

  describe('quick replies (D6) and the migration', () => {
    async function globals() {
      await ds.query(
        `INSERT INTO wa_keyword_templates (kind, name, match_type, patterns, priority, response_text, terminal, active, mandatory)
         VALUES ('crisis', 'Crisis', 'any_of', '{suicide}', 10, 'Please call {helpline_numbers}', true, true, true),
                ('faq', 'Hours', 'contains', '{hours}', 300, 'We open at 9', false, true, false)`,
      );
    }

    it('copies every active global once per chatbot, locking the mandatory ones', async () => {
      await globals();
      const bot = await seedChatbot(ds);
      const service = new QuickReplyCopyService(ds);
      expect(await service.copyGlobalsInto(bot)).toEqual({
        copied: 2,
        locked: 0,
      });
      expect(await service.copyGlobalsInto(bot)).toEqual({
        copied: 0,
        locked: 0,
      });
      const rows = await ds.query(
        `SELECT name, locked FROM wa_keyword_templates WHERE chatbot_id = $1 ORDER BY name`,
        [bot],
      );
      expect(rows).toEqual([
        { name: 'Crisis', locked: true },
        { name: 'Hours', locked: false },
      ]);
    });

    it('staff push rewrites every locked copy and keeps regional numbers', async () => {
      await globals();
      const bot = await seedChatbot(ds);
      const service = new QuickReplyCopyService(ds);
      await service.copyGlobalsInto(bot);
      await ds.query(
        `UPDATE wa_keyword_templates SET extra_numbers = '{"+91 9152987821"}' WHERE chatbot_id = $1 AND locked`,
        [bot],
      );
      const [global] = await ds.query(
        `SELECT id FROM wa_keyword_templates WHERE chatbot_id IS NULL AND name = 'Crisis'`,
      );
      const result = await service.pushLocked(
        global.id,
        { responseText: 'Help: {helpline_numbers}' },
        1,
      );
      expect(result.copies).toBe(1);
      const [copy] = await ds.query(
        `SELECT response_text, extra_numbers FROM wa_keyword_templates WHERE chatbot_id = $1 AND locked`,
        [bot],
      );
      expect(copy).toEqual({
        response_text: 'Help: {helpline_numbers}',
        extra_numbers: ['+91 9152987821'],
      });
    });

    it('the migration dry run writes nothing and a second real run reports zeros', async () => {
      await globals();
      const a = await seedChatbot(ds, 'A');
      const b = await seedChatbot(ds, 'B');
      const [shared] = await ds.query(
        `INSERT INTO kb_documents (title, source_type, raw_text, tags, status, content_hash, created_by, corpus, is_global)
         VALUES ('Library', 'paste', 'Shared text', '{}', 'indexed', 'h', 1, 'whatsapp_qa', true) RETURNING id`,
      );
      await ds.query(
        `INSERT INTO chatbot_documents (chatbot_id, document_id) VALUES ($1, $3), ($2, $3)`,
        [a, b, shared.id],
      );
      const dry = await runStage5Migration(ds, { dryRun: true });
      expect(dry.documents.attachments).toBe(2);
      const [docs] = await ds.query(
        `SELECT count(*)::int AS n FROM kb_documents`,
      );
      expect(docs.n).toBe(1);
      const queued: string[] = [];
      const real = await runStage5Migration(ds, {
        dryRun: false,
        enqueue: async (job) => {
          queued.push(job.action);
        },
      });
      expect(real.documents.copied).toBe(2);
      expect(queued).toEqual(['ingest', 'ingest']);
      const attached = await ds.query(
        `SELECT cd.chatbot_id, d.owner_chatbot_id FROM chatbot_documents cd JOIN kb_documents d ON d.id = cd.document_id ORDER BY cd.chatbot_id`,
      );
      expect(
        attached.every(
          (r: { chatbot_id: string; owner_chatbot_id: string }) =>
            r.chatbot_id === r.owner_chatbot_id,
        ),
      ).toBe(true);
      const second = await runStage5Migration(ds, { dryRun: false });
      expect(second.documents.copied).toBe(0);
      expect(second.quickReplies.copied).toBe(0);
      expect(second.defaults.chatbots).toBe(0);
    });
  });
});
