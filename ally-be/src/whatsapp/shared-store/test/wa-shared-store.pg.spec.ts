import { DataSource } from 'typeorm';
import { ChatbotConversation } from 'src/chatbot/entity/chatbot-conversation.entity';
import { ChatbotMessage } from 'src/chatbot/entity/chatbot-message.entity';
import { ConversationService } from 'src/chatbot/service/conversation.service';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import { WhatsAppRetentionService } from '../../service/whatsapp-retention.service';
import type { WhatsAppBotSettings } from '../../type/whatsapp-settings.type';
import { WaSharedStoreWriter } from '../wa-shared-store.writer';
import { buildInboundHarness } from './inbound-harness';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from './shared-store.pg';

describePg('WhatsApp dual-write to the shared store (Postgres)', () => {
  let dataSource: DataSource;
  let conversations: ConversationService;
  let chatbotId: string;

  const repositories = () => ({
    contacts: dataSource.getRepository(WaContact),
    conversations: dataSource.getRepository(WaConversation),
    messages: dataSource.getRepository(WaMessage),
    unanswered: dataSource.getRepository(WaUnansweredQuestion),
  });

  const writerWith = (
    settings: () => Promise<WhatsAppBotSettings>,
    store: ConversationService = conversations,
  ) =>
    new WaSharedStoreWriter(
      store,
      { get: settings } as never,
      dataSource.getRepository(WaMessage),
      dataSource.getRepository(WaConversation),
      dataSource.getRepository(WaContact),
    );

  /** One inbound handler whose writer reads the harness's own settings. */
  function harness(
    settings: Partial<WhatsAppBotSettings>,
    store?: ConversationService,
  ) {
    const holder: { settings?: WhatsAppBotSettings } = {};
    const writer = writerWith(async () => holder.settings!, store);
    const built = buildInboundHarness({
      repositories: repositories(),
      chatbotId,
      settings,
      sharedStore: writer,
    });
    holder.settings = built.settings;
    return { ...built, writer };
  }

  const waRows = () =>
    dataSource.query(
      `SELECT id, conversation_id, direction, body, status, provider_message_id, handled_by,
              "createdAt", in_reply_to_id
         FROM wa_messages ORDER BY "createdAt", direction`,
    );
  const sharedRows = () =>
    dataSource.query(
      `SELECT id, conversation_id, direction, text AS body, status, provider_message_id,
              handled_by, "createdAt", in_reply_to_id
         FROM chatbot_messages ORDER BY "createdAt", direction`,
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    conversations = new ConversationService(
      dataSource,
      dataSource.getRepository(ChatbotConversation),
      dataSource.getRepository(ChatbotMessage),
    );
  });
  afterAll(async () => closeTestDataSource(dataSource));
  beforeEach(async () => {
    await resetTables(dataSource);
    chatbotId = await seedChatbot(dataSource);
  });

  it('writes every inbound message and reply to both stores, with the same ids', async () => {
    const { inbound, writer } = harness({ sharedStoreWrites: true });
    await inbound('how do I get access?');
    await inbound('and after that?');
    await writer.settled();

    const wa = await waRows();
    expect(wa).toHaveLength(4);
    expect(await sharedRows()).toEqual(wa);

    const [waThread] = await dataSource.query(
      `SELECT id, contact_id, started_at, last_message_at FROM wa_conversations`,
    );
    const [sharedThread] = await dataSource.query(
      `SELECT id, contact_id, started_at, last_message_at, channel FROM chatbot_conversations`,
    );
    expect(sharedThread).toEqual({ ...waThread, channel: 'whatsapp' });
    const [identity] = await dataSource.query(
      `SELECT external_id, verified, chatbot_id FROM chatbot_contact_identities`,
    );
    expect(identity).toEqual({
      external_id: '919800000001',
      verified: true,
      chatbot_id: chatbotId,
    });
  });

  it('writes nothing to the shared store with the switch off', async () => {
    const { inbound, writer } = harness({ sharedStoreWrites: false });
    await inbound('how do I get access?');
    await writer.settled();
    expect(await waRows()).toHaveLength(2);
    expect(await sharedRows()).toEqual([]);
  });

  it('a shared store that fails changes nothing on WhatsApp', async () => {
    const broken = {
      resolveContact: async () => {
        throw new Error('shared store down');
      },
      openConversation: async () => {
        throw new Error('shared store down');
      },
      appendMessage: async () => {
        throw new Error('shared store down');
      },
      updateMessage: async () => {
        throw new Error('shared store down');
      },
      recentHistory: async () => {
        throw new Error('shared store down');
      },
    } as unknown as ConversationService;

    const failing = harness(
      { sharedStoreWrites: true, readHistoryFrom: 'shared' },
      broken,
    );
    await failing.inbound('how do I get access?');
    await failing.inbound('and after that?');
    await failing.writer.settled();
    const withFailure = await waRows();
    const failingHistory = failing.engine.respond.mock.calls[1][0].history;

    await resetTables(dataSource);
    chatbotId = await seedChatbot(dataSource);
    const plain = buildInboundHarness({
      repositories: repositories(),
      chatbotId,
    });
    await plain.inbound('how do I get access?');
    await plain.inbound('and after that?');
    const withoutStore = await waRows();

    const shape = (rows: Record<string, unknown>[]) =>
      rows.map(({ direction, body, status, handled_by }) => ({
        direction,
        body,
        status,
        handled_by,
      }));
    expect(shape(withFailure)).toEqual(shape(withoutStore));
    expect(failing.provider.sendText).toHaveBeenCalledTimes(2);
    expect(failingHistory).toEqual(
      plain.engine.respond.mock.calls[1][0].history,
    );
  });

  it('readHistoryFrom=shared gives the engine exactly the history wa gives it', async () => {
    const turns = ['how do I get access?', 'and after that?', 'and then?'];

    const fromWa = harness({ sharedStoreWrites: true, readHistoryFrom: 'wa' });
    for (const text of turns) await fromWa.inbound(text);
    await fromWa.writer.settled();
    const waInputs = fromWa.engine.respond.mock.calls.map(([turn]) => turn);

    await resetTables(dataSource);
    chatbotId = await seedChatbot(dataSource);
    const fromShared = harness({
      sharedStoreWrites: true,
      readHistoryFrom: 'shared',
    });
    for (const text of turns) await fromShared.inbound(text);
    await fromShared.writer.settled();
    const sharedInputs = fromShared.engine.respond.mock.calls.map(
      ([turn]) => turn,
    );

    const comparable = (turn: Record<string, any>) => ({
      text: turn.text,
      history: turn.history,
      isFirstMessage: turn.isFirstMessage,
      language: turn.language,
    });
    expect(sharedInputs.map(comparable)).toEqual(waInputs.map(comparable));
    // The message being answered is the last history turn, as on wa.
    expect(sharedInputs[2].history[sharedInputs[2].history.length - 1]).toEqual(
      {
        role: 'user',
        content: 'and then?',
      },
    );
    expect(sharedInputs[2].history).toHaveLength(5);
  });

  describe('retention', () => {
    const old = new Date('2025-01-01T00:00:00Z');

    /**
     * Ages the messages only. Ageing the threads too would make the WhatsApp sweep blank the
     * contact's number, which fails on real Postgres today: `erased:<uuid>` (43 characters) does
     * not fit `wa_contacts.phone_e164` (varchar 32). A pre-existing bug, reported in
     * CHUNK-12-NOTES.md and not changed here. The shared identities' blanking is covered in
     * conversation-service.pg.spec.ts.
     */
    async function ageMessages() {
      await dataSource.query(`UPDATE wa_messages SET "createdAt" = $1`, [old]);
      await dataSource.query(`UPDATE chatbot_messages SET "createdAt" = $1`, [
        old,
      ]);
    }

    const retention = (store?: ConversationService) =>
      new WhatsAppRetentionService(
        dataSource.getRepository(WaMessage),
        dataSource.getRepository(WaContact),
        dataSource.getRepository(WaConversation),
        dataSource.getRepository(WaUnansweredQuestion),
        { get: async () => ({ retentionDays: 30 }) } as never,
        store,
      );

    it('blanks wa_* first, then the shared tables', async () => {
      const { inbound, writer } = harness({ sharedStoreWrites: true });
      await inbound('how do I get access?');
      await writer.settled();
      await ageMessages();

      await retention(conversations).runRetentionSweep();

      const bodies = (rows: { body: string }[]) => rows.map((r) => r.body);
      expect(bodies(await waRows())).toEqual(['[erased]', '[erased]']);
      expect(bodies(await sharedRows())).toEqual(['[erased]', '[erased]']);
    });

    it('a failed shared pass leaves wa_* swept, and the next run finishes it', async () => {
      const { inbound, writer } = harness({ sharedStoreWrites: true });
      await inbound('how do I get access?');
      await writer.settled();
      await ageMessages();

      const failing = {
        blankBefore: async () => {
          throw new Error('shared store down');
        },
      } as unknown as ConversationService;
      await expect(
        retention(failing).runRetentionSweep(),
      ).resolves.toBeUndefined();
      const bodies = (rows: { body: string }[]) => rows.map((r) => r.body);
      expect(bodies(await waRows())).toEqual(['[erased]', '[erased]']);
      expect(bodies(await sharedRows())).not.toContain('[erased]');

      // Next hour: wa_* has nothing left past the cutoff, the shared store still does.
      await retention(conversations).runRetentionSweep();
      expect(bodies(await sharedRows())).toEqual(['[erased]', '[erased]']);
    });
  });
});
