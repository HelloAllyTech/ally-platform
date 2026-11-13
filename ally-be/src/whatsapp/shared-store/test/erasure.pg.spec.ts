import { DataSource } from 'typeorm';
import { ChatbotConversation } from 'src/chatbot/entity/chatbot-conversation.entity';
import { ChatbotMessage } from 'src/chatbot/entity/chatbot-message.entity';
import { ConversationService } from 'src/chatbot/service/conversation.service';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import { WhatsAppConversationService } from '../../service/whatsapp-conversation.service';
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

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * Chunk H0: erasure on real Postgres. `erased:<contact id>` is 43 characters, which did not fit
 * `wa_contacts.phone_e164` before migration 1981900948000 widened it, so both an admin's erase
 * and the retention sweep threw part-way (CHUNK-12-NOTES.md §7). The mocked specs never saw it.
 */
describePg('Erasure and the retention sweep (Postgres)', () => {
  let dataSource: DataSource;
  let conversations: ConversationService;
  let chatbotId: string;

  /** One WhatsApp thread written to both stores by the real inbound handler. */
  async function thread(): Promise<string> {
    const holder: { settings?: WhatsAppBotSettings } = {};
    const writer = new WaSharedStoreWriter(
      conversations,
      { get: async () => holder.settings! } as never,
      dataSource.getRepository(WaMessage),
      dataSource.getRepository(WaConversation),
      dataSource.getRepository(WaContact),
    );
    const built = buildInboundHarness({
      repositories: {
        contacts: dataSource.getRepository(WaContact),
        conversations: dataSource.getRepository(WaConversation),
        messages: dataSource.getRepository(WaMessage),
        unanswered: dataSource.getRepository(WaUnansweredQuestion),
      },
      chatbotId,
      settings: { sharedStoreWrites: true },
      sharedStore: writer,
    });
    holder.settings = built.settings;
    await built.inbound('my number is on file, can you check my booking?');
    await writer.settled();
    const [contact] = await dataSource.query(`SELECT id FROM wa_contacts`);
    return contact.id;
  }

  /** Everything erasure touches, to compare before and after a second run. */
  const snapshot = async () => ({
    contacts: await dataSource.query(
      `SELECT id, phone_e164, phone_last4 FROM wa_contacts ORDER BY id`,
    ),
    waBodies: await dataSource.query(
      `SELECT id, body FROM wa_messages ORDER BY id`,
    ),
    sharedTexts: await dataSource.query(
      `SELECT id, text FROM chatbot_messages ORDER BY id`,
    ),
    identities: await dataSource.query(
      `SELECT external_id FROM chatbot_contact_identities ORDER BY external_id`,
    ),
  });

  const expectErased = (
    state: Awaited<ReturnType<typeof snapshot>>,
    contactId: string,
  ) => {
    expect(state.contacts).toEqual([
      { id: contactId, phone_e164: `erased:${contactId}`, phone_last4: '0000' },
    ]);
    expect(state.waBodies.length).toBeGreaterThan(0);
    expect(state.waBodies.every((r) => r.body === '[erased]')).toBe(true);
    expect(state.sharedTexts.length).toBeGreaterThan(0);
    expect(state.sharedTexts.every((r) => r.text === '[erased]')).toBe(true);
    expect(
      state.identities.every((r) => r.external_id.startsWith('erased:')),
    ).toBe(true);
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource([Tenant]);
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

  it('erasing a contact finishes, blanks both stores, and a second erase changes nothing', async () => {
    const contactId = await thread();
    const service = new WhatsAppConversationService(
      dataSource.getRepository(WaContact),
      dataSource.getRepository(WaConversation),
      dataSource.getRepository(WaMessage),
      dataSource.getRepository(WaUnansweredQuestion),
      dataSource.getRepository(Tenant),
      {} as never,
      {} as never,
      { accessibleChatbotIds: async () => null } as never,
      conversations,
    );

    await expect(service.eraseContact(contactId)).resolves.toEqual({
      id: contactId,
      erased: true,
    });
    const after = await snapshot();
    expectErased(after, contactId);

    await service.eraseContact(contactId);
    expect(await snapshot()).toEqual(after);
  });

  it('the retention sweep erases a stale contact, blanks both stores, and a second run changes nothing', async () => {
    const contactId = await thread();
    const old = new Date('2025-01-01T00:00:00Z');
    await dataSource.query(`UPDATE wa_messages SET "createdAt" = $1`, [old]);
    await dataSource.query(`UPDATE wa_conversations SET last_message_at = $1`, [
      old,
    ]);
    await dataSource.query(`UPDATE chatbot_messages SET "createdAt" = $1`, [
      old,
    ]);
    await dataSource.query(
      `UPDATE chatbot_conversations SET last_message_at = $1`,
      [old],
    );
    const retention = new WhatsAppRetentionService(
      dataSource.getRepository(WaMessage),
      dataSource.getRepository(WaContact),
      dataSource.getRepository(WaConversation),
      dataSource.getRepository(WaUnansweredQuestion),
      { get: async () => ({ retentionDays: 30 }) } as never,
      conversations,
    );

    await expect(retention.runRetentionSweep()).resolves.toBeUndefined();
    const after = await snapshot();
    expectErased(after, contactId);

    await retention.runRetentionSweep();
    expect(await snapshot()).toEqual(after);
  });
});
