import { DataSource } from 'typeorm';
import { ChatbotConversation } from 'src/chatbot/entity/chatbot-conversation.entity';
import { ChatbotMessage } from 'src/chatbot/entity/chatbot-message.entity';
import {
  ConversationChannel,
  ConversationMessageRole,
} from 'src/chatbot/enum/conversation.enum';
import { ConversationService } from 'src/chatbot/service/conversation.service';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaMessageDirection, WaMessageStatus } from '../../enum/whatsapp.enum';
import { WhatsAppInboundService } from '../../service/whatsapp-inbound.service';
import { sharedMessageOf } from '../wa-shared-store.mapper';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
  seedWhatsAppThread,
} from './shared-store.pg';

const WA = ConversationChannel.WHATSAPP;
const minutes = (n: number) => n * 60_000;

describePg('ConversationService (Postgres)', () => {
  let dataSource: DataSource;
  let service: ConversationService;
  let botA: string;
  let botB: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    service = new ConversationService(
      dataSource,
      dataSource.getRepository(ChatbotConversation),
      dataSource.getRepository(ChatbotMessage),
    );
  });
  afterAll(async () => closeTestDataSource(dataSource));
  beforeEach(async () => {
    await resetTables(dataSource);
    botA = await seedChatbot(dataSource, 'A');
    botB = await seedChatbot(dataSource, 'B');
  });

  const message = (
    overrides: Partial<Parameters<ConversationService['appendMessage']>[1]>,
  ) => ({
    channel: WA,
    direction: WaMessageDirection.INBOUND,
    role: ConversationMessageRole.USER,
    text: 'hello',
    status: WaMessageStatus.RECEIVED,
    ...overrides,
  });

  describe('resolveContact', () => {
    it('creates a contact with its identity once, then finds it', async () => {
      const first = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '919800000001',
        { verified: true },
      );
      const again = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '919800000001',
      );
      expect(again.id).toBe(first.id);
      const [identity] = await dataSource.query(
        `SELECT * FROM chatbot_contact_identities WHERE contact_id = $1`,
        [first.id],
      );
      expect(identity).toMatchObject({
        channel: 'whatsapp',
        external_id: '919800000001',
        verified: true,
        chatbot_id: botA,
      });
    });

    it('scopes a contact to one bot: the same number on two bots is two contacts', async () => {
      const onA = await service.resolveContact({ chatbotId: botA }, WA, '9198');
      const onB = await service.resolveContact({ chatbotId: botB }, WA, '9198');
      expect(onA.id).not.toBe(onB.id);
    });

    it('takes the first preferred id nobody holds', async () => {
      const preferred = ['6f4e1d1e-0000-4000-8000-000000000001'];
      const second = '6f4e1d1e-0000-4000-8000-000000000002';
      const onA = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '9198',
        {
          preferredIds: [...preferred, second],
        },
      );
      const onB = await service.resolveContact(
        { chatbotId: botB },
        WA,
        '9198',
        {
          preferredIds: [...preferred, second],
        },
      );
      expect(onA.id).toBe(preferred[0]);
      expect(onB.id).toBe(second);
    });

    it('two writers racing for one identity get the same contact', async () => {
      const [one, two] = await Promise.all([
        service.resolveContact({ chatbotId: botA }, WA, '9199'),
        service.resolveContact({ chatbotId: botA }, WA, '9199'),
      ]);
      expect(one.id).toBe(two.id);
      const [{ count }] = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM chatbot_contacts`,
      );
      expect(count).toBe(1);
    });
  });

  describe('openConversation', () => {
    const now = new Date('2026-11-07T10:00:00Z');
    let contact: string;
    beforeEach(async () => {
      contact = (await service.resolveContact({ chatbotId: botA }, WA, '9198'))
        .id;
    });
    const open = (at: Date, chatbotId = botA, channel = WA) =>
      service.openConversation(chatbotId, contact, channel, {
        idleWindowMinutes: 1440,
        now: at,
      });

    it('reuses the thread within the idle window and moves last_message_at', async () => {
      const first = await open(now);
      const later = new Date(now.getTime() + minutes(1439));
      const second = await open(later);
      expect(second.id).toBe(first.id);
      const stored = await dataSource
        .getRepository(ChatbotConversation)
        .findOneByOrFail({ id: first.id });
      expect(stored.lastMessageAt.getTime()).toBe(later.getTime());
    });

    it('starts a new thread after the idle window', async () => {
      const first = await open(now);
      const second = await open(new Date(now.getTime() + minutes(1441)));
      expect(second.id).not.toBe(first.id);
    });

    it("never hands one bot another bot's thread", async () => {
      const onA = await open(now);
      const contactOnB = (
        await service.resolveContact({ chatbotId: botB }, WA, '9198')
      ).id;
      const onB = await service.openConversation(botB, contactOnB, WA, {
        idleWindowMinutes: 1440,
        now,
      });
      expect(onB.id).not.toBe(onA.id);
    });

    it('keeps channels apart', async () => {
      const whatsapp = await open(now);
      const web = await open(now, botA, ConversationChannel.WEB);
      expect(web.id).not.toBe(whatsapp.id);
    });

    it('with an id, creates that thread and only ever moves last_message_at forward', async () => {
      const id = '6f4e1d1e-0000-4000-8000-0000000000aa';
      const options = (at: Date) => ({ id, startedAt: now, now: at });
      await service.openConversation(botA, contact, WA, options(now));
      const later = new Date(now.getTime() + minutes(5));
      await service.openConversation(botA, contact, WA, options(later));
      const stale = await service.openConversation(
        botA,
        contact,
        WA,
        options(now),
      );
      expect(stale.id).toBe(id);
      expect(stale.lastMessageAt.getTime()).toBe(later.getTime());
      expect(stale.startedAt.getTime()).toBe(now.getTime());
    });
  });

  describe('messages', () => {
    let conversationId: string;
    beforeEach(async () => {
      const contact = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '91',
      );
      conversationId = (
        await service.openConversation(botA, contact.id, WA, {
          idleWindowMinutes: 10,
        })
      ).id;
    });

    it('appendMessage is idempotent on the id, and keeps a copied createdAt', async () => {
      const at = new Date('2026-01-02T03:04:05.678Z');
      const input = message({
        id: '6f4e1d1e-0000-4000-8000-0000000000bb',
        createdAt: at,
      });
      const first = await service.appendMessage(conversationId, input);
      const again = await service.appendMessage(
        conversationId,
        message({ ...input, text: 'changed' }),
      );
      expect(again.id).toBe(first.id);
      expect(again.text).toBe('hello');
      expect(first.createdAt.getTime()).toBe(at.getTime());
    });

    it('appendMessage is idempotent on (channel, provider id)', async () => {
      const first = await service.appendMessage(
        conversationId,
        message({ providerMessageId: 'wamid.1' }),
      );
      const again = await service.appendMessage(
        conversationId,
        message({ providerMessageId: 'wamid.1', text: 'redelivered' }),
      );
      expect(again.id).toBe(first.id);
      const [{ count }] = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM chatbot_messages`,
      );
      expect(count).toBe(1);
    });

    it('updateMessage records delivery', async () => {
      const row = await service.appendMessage(
        conversationId,
        message({ status: WaMessageStatus.QUEUED }),
      );
      await service.updateMessage(row.id, {
        status: WaMessageStatus.SENT,
        providerMessageId: 'wamid.out',
      });
      const stored = await dataSource
        .getRepository(ChatbotMessage)
        .findOneByOrFail({ id: row.id });
      expect(stored).toMatchObject({
        status: WaMessageStatus.SENT,
        providerMessageId: 'wamid.out',
      });
    });

    it('setMetadata merges keys', async () => {
      await service.setMetadata(conversationId, { name: 'Asha' });
      await service.setMetadata(conversationId, { reason: 'fees' });
      const stored = await dataSource
        .getRepository(ChatbotConversation)
        .findOneByOrFail({ id: conversationId });
      expect(stored.metadata).toEqual({ name: 'Asha', reason: 'fees' });
    });
  });

  describe('recentHistory', () => {
    it("equals WhatsApp's helper on the same rows, the message being answered included", async () => {
      const start = new Date('2026-11-07T09:00:00Z').getTime();
      const bodies = Array.from({ length: 12 }, (_, i) =>
        i === 7 ? '   ' : `message ${i}`,
      );
      const seeded = await seedWhatsAppThread(dataSource, {
        chatbotId: botA,
        messages: bodies.map((body, i) => ({
          body,
          at: new Date(start + i * 1000),
        })),
      });
      const contact = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '91',
      );
      await service.openConversation(botA, contact.id, WA, {
        id: seeded.conversationId,
      });
      const rows = await dataSource
        .getRepository(WaMessage)
        .findBy({ conversationId: seeded.conversationId });
      for (const row of rows) {
        await service.appendMessage(
          seeded.conversationId,
          sharedMessageOf(row),
        );
      }

      const today = await (
        WhatsAppInboundService.prototype as unknown as {
          recentHistory: (
            this: unknown,
            id: string,
          ) => Promise<{ role: string; content: string }[]>;
        }
      ).recentHistory.call(
        { messageRepository: dataSource.getRepository(WaMessage) },
        seeded.conversationId,
      );
      const shared = await service.recentHistory(seeded.conversationId);

      expect(shared).toEqual(today);
      expect(shared[shared.length - 1].content).toBe('message 11');
      expect(shared).toHaveLength(9); // the last 10, minus the blank one
    });
  });

  describe('retention and erasure', () => {
    it('blankBefore blanks old text and stale identities, and is a no-op the second time', async () => {
      const old = new Date('2025-01-01T00:00:00Z');
      const contact = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '9197',
      );
      const conversation = await service.openConversation(
        botA,
        contact.id,
        WA,
        { id: '6f4e1d1e-0000-4000-8000-0000000000cc', now: old },
      );
      await service.appendMessage(
        conversation.id,
        message({ createdAt: old, citations: [{ chunk: 1 }] }),
      );
      const cutoff = new Date('2026-01-01T00:00:00Z');
      const placeholders = { text: '[erased]', erasedPrefix: 'erased:' };

      expect(await service.blankBefore(cutoff, placeholders)).toEqual({
        messages: 1,
        identities: 1,
      });
      expect(await service.blankBefore(cutoff, placeholders)).toEqual({
        messages: 0,
        identities: 0,
      });
      const [msg] = await dataSource.query(
        `SELECT text, citations FROM chatbot_messages`,
      );
      expect(msg).toEqual({ text: '[erased]', citations: null });
      const [identity] = await dataSource.query(
        `SELECT external_id FROM chatbot_contact_identities`,
      );
      expect(identity.external_id).toBe(`erased:${contact.id}`);
    });

    it("eraseConversations blanks the threads' messages and their contacts' identities", async () => {
      const contact = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '9196',
      );
      const conversation = await service.openConversation(
        botA,
        contact.id,
        WA,
        { idleWindowMinutes: 10 },
      );
      await service.appendMessage(conversation.id, message({}));
      await service.eraseConversations([conversation.id], WA, {
        text: '[erased]',
        erasedPrefix: 'erased:',
      });
      const [msg] = await dataSource.query(`SELECT text FROM chatbot_messages`);
      expect(msg.text).toBe('[erased]');
      const again = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '9196',
      );
      expect(again.id).not.toBe(contact.id);
    });

    // The agent's tool calls and its hand-over summary are as personal as the messages (chunk 3b).
    const toolRun = (conversationId: string, chatbotId: string, at?: Date) =>
      dataSource.query(
        `INSERT INTO tool_runs (chatbot_id, conversation_id, run_id, step, tool, input, status, "createdAt")
         VALUES ($1, $2, gen_random_uuid()::text, 0, 'hand_over', '{"summary":"call me"}', 'ok', $3)`,
        [chatbotId, conversationId, at ?? new Date()],
      );
    const metadataOf = async (id: string) =>
      (
        await dataSource.query(
          `SELECT metadata FROM chatbot_conversations WHERE id = $1`,
          [id],
        )
      )[0].metadata;
    const placeholders = { text: '[erased]', erasedPrefix: 'erased:' };

    it("eraseConversations deletes the threads' tool runs and hand-over summaries, and no one else's", async () => {
      const mine = await service.openConversation(
        botA,
        (await service.resolveContact({ chatbotId: botA }, WA, '9181')).id,
        WA,
        { idleWindowMinutes: 10 },
      );
      const theirs = await service.openConversation(
        botA,
        (await service.resolveContact({ chatbotId: botA }, WA, '9182')).id,
        WA,
        { idleWindowMinutes: 10 },
      );
      for (const c of [mine, theirs]) {
        await service.setMetadata(c.id, {
          intake: { name: 'A' },
          handover: { summary: 'call me' },
          handoverEmailedAt: 'x',
        });
        await toolRun(c.id, botA);
      }
      await toolRun('preview-1', botA);

      await service.eraseConversations([mine.id], WA, placeholders);

      const left = (await dataSource.query(
        `SELECT conversation_id FROM tool_runs`,
      )) as {
        conversation_id: string;
      }[];
      expect(left.map((row) => row.conversation_id).sort()).toEqual(
        [theirs.id, 'preview-1'].sort(),
      );
      expect(await metadataOf(mine.id)).toEqual({ handoverEmailedAt: 'x' });
      expect(await metadataOf(theirs.id)).toMatchObject({
        handover: { summary: 'call me' },
      });
    });

    it("eraseContact (the bot page's path) deletes their tool runs and hand-over summaries", async () => {
      const contact = await service.resolveContact(
        { chatbotId: botB },
        ConversationChannel.WEB,
        'visitor-1',
      );
      const c = await service.openConversation(
        botB,
        contact.id,
        ConversationChannel.WEB,
        { idleWindowMinutes: 10 },
      );
      await service.setMetadata(c.id, { handover: { summary: 'call me' } });
      await toolRun(c.id, botB);

      await service.eraseContact(contact.id, placeholders);

      expect(await dataSource.query(`SELECT 1 FROM tool_runs`)).toEqual([]);
      expect(await metadataOf(c.id)).toEqual({});
    });

    it('blankBefore deletes tool runs and hand-over summaries past the cutoff, and keeps newer ones', async () => {
      const old = new Date('2025-01-01T00:00:00Z');
      const cutoff = new Date('2026-01-01T00:00:00Z');
      const contact = await service.resolveContact(
        { chatbotId: botA },
        WA,
        '9183',
      );
      const stale = await service.openConversation(botA, contact.id, WA, {
        id: '6f4e1d1e-0000-4000-8000-0000000000dd',
        now: old,
      });
      await service.setMetadata(stale.id, { handover: { summary: 'old' } });
      await toolRun(stale.id, botA, old);
      const fresh = await service.openConversation(
        botA,
        (await service.resolveContact({ chatbotId: botA }, WA, '9184')).id,
        WA,
        { idleWindowMinutes: 10 },
      );
      await service.setMetadata(fresh.id, { handover: { summary: 'new' } });
      await toolRun(fresh.id, botA);

      await service.blankBefore(cutoff, placeholders);

      expect(
        await dataSource.query(`SELECT conversation_id FROM tool_runs`),
      ).toEqual([{ conversation_id: fresh.id }]);
      expect(await metadataOf(stale.id)).toEqual({});
      expect(await metadataOf(fresh.id)).toEqual({
        handover: { summary: 'new' },
      });
    });
  });
});
