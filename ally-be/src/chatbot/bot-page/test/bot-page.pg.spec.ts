import { DataSource } from 'typeorm';
import { ChatbotAudience } from '../../entity/chatbot-audience.entity';
import { ChatbotConversation } from '../../entity/chatbot-conversation.entity';
import { ChatbotMessage } from '../../entity/chatbot-message.entity';
import { ChatbotPageAccess } from '../../entity/chatbot-page-access.entity';
import { BotPageAccessKind } from '../../enum/bot-page.enum';
import {
  ChatbotAccessMode,
  ChatbotAudienceKind,
} from '../../enum/chatbot.enum';
import {
  ConversationChannel,
  ConversationMessageRole,
  ConversationStatus,
} from '../../enum/conversation.enum';
import { ChatbotAudienceService } from '../../service/chatbot-audience.service';
import { ConversationService } from '../../service/conversation.service';
import { BotPageAccessService } from '../bot-page-access.service';
import {
  WaMessageDirection,
  WaMessageStatus,
} from '../../../whatsapp/enum/whatsapp.enum';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../../whatsapp/shared-store/test/shared-store.pg';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

const WEB = ConversationChannel.WEB;
const EMAIL = ConversationChannel.EMAIL;
const PLACEHOLDERS = { text: '[erased]', erasedPrefix: 'erased:' };

describePg('Bot page on the shared store (Postgres)', () => {
  let dataSource: DataSource;
  let conversations: ConversationService;
  let bot: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource([ChatbotAudience, ChatbotPageAccess]);
    conversations = new ConversationService(
      dataSource,
      dataSource.getRepository(ChatbotConversation),
      dataSource.getRepository(ChatbotMessage),
    );
  });
  afterAll(async () => closeTestDataSource(dataSource));
  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE chatbot_pages, chatbot_page_access, chatbot_audience CASCADE`,
    );
    bot = await seedChatbot(dataSource, 'Sunrise');
  });

  const say = (conversationId: string, text: string) =>
    conversations.appendMessage(conversationId, {
      channel: WEB,
      direction: WaMessageDirection.INBOUND,
      role: ConversationMessageRole.USER,
      text,
      status: WaMessageStatus.SENT,
    });

  it('resumes the open thread within the idle window, and New chat starts another', async () => {
    const contact = await conversations.resolveContact(
      { chatbotId: bot },
      WEB,
      'visitor-1',
    );
    const first = await conversations.openConversation(bot, contact.id, WEB, {
      idleWindowMinutes: 60,
    });
    await say(first.id, 'hello');
    const again = await conversations.openConversation(bot, contact.id, WEB, {
      idleWindowMinutes: 60,
    });
    expect(again.id).toBe(first.id);
    expect(
      (await conversations.currentConversation(bot, contact.id, WEB, 60))?.id,
    ).toBe(first.id);

    await conversations.closeConversation(first.id);
    expect(
      await conversations.currentConversation(bot, contact.id, WEB, 60),
    ).toBeNull();
    const fresh = await conversations.openConversation(bot, contact.id, WEB, {
      idleWindowMinutes: 60,
    });
    expect(fresh.id).not.toBe(first.id);
    const [row] = await dataSource.query(
      `SELECT status FROM chatbot_conversations WHERE id = $1`,
      [first.id],
    );
    expect(row.status).toBe(ConversationStatus.CLOSED);
  });

  it('a WhatsApp thread, never closed, is reused exactly as before', async () => {
    const contact = await conversations.resolveContact(
      { chatbotId: bot },
      ConversationChannel.WHATSAPP,
      '+911',
    );
    const a = await conversations.openConversation(
      bot,
      contact.id,
      ConversationChannel.WHATSAPP,
      { idleWindowMinutes: 60 },
    );
    const b = await conversations.openConversation(
      bot,
      contact.id,
      ConversationChannel.WHATSAPP,
      { idleWindowMinutes: 60 },
    );
    expect(b.id).toBe(a.id);
  });

  it('an email verified on a second device continues as the same contact', async () => {
    const first = await conversations.resolveVerifiedContact(
      { chatbotId: bot },
      { channel: EMAIL, externalId: 'asha@example.com' },
      { channel: WEB, externalId: 'phone-visitor' },
    );
    const second = await conversations.resolveVerifiedContact(
      { chatbotId: bot },
      { channel: EMAIL, externalId: 'asha@example.com' },
      { channel: WEB, externalId: 'laptop-visitor' },
    );
    expect(second.id).toBe(first.id);
    expect(
      (
        await conversations.contactByIdentity(
          { chatbotId: bot },
          WEB,
          'laptop-visitor',
        )
      )?.id,
    ).toBe(first.id);
    expect(await conversations.identityOf(first.id, EMAIL)).toMatchObject({
      externalId: 'asha@example.com',
      verified: true,
    });
  });

  it('a device that verifies a different email moves to that email’s contact', async () => {
    const asha = await conversations.resolveVerifiedContact(
      { chatbotId: bot },
      { channel: EMAIL, externalId: 'asha@example.com' },
      { channel: WEB, externalId: 'shared-laptop' },
    );
    const ravi = await conversations.resolveVerifiedContact(
      { chatbotId: bot },
      { channel: EMAIL, externalId: 'ravi@example.com' },
      { channel: WEB, externalId: 'ravi-phone' },
    );
    const moved = await conversations.resolveVerifiedContact(
      { chatbotId: bot },
      { channel: EMAIL, externalId: 'ravi@example.com' },
      { channel: WEB, externalId: 'shared-laptop' },
    );
    expect(moved.id).toBe(ravi.id);
    expect(moved.id).not.toBe(asha.id);
    expect(
      (
        await conversations.contactByIdentity(
          { chatbotId: bot },
          WEB,
          'shared-laptop',
        )
      )?.id,
    ).toBe(ravi.id);
  });

  it('latestMetadata finds the newest pre-chat answers across a contact’s threads', async () => {
    const contact = await conversations.resolveContact(
      { chatbotId: bot },
      WEB,
      'v',
    );
    const a = await conversations.openConversation(bot, contact.id, WEB, {
      idleWindowMinutes: 60,
    });
    await conversations.setMetadata(a.id, {
      intake: { answers: [{ id: 'name', value: 'Asha' }] },
    });
    await conversations.closeConversation(a.id);
    const b = await conversations.openConversation(bot, contact.id, WEB, {
      idleWindowMinutes: 60,
    });
    expect(
      await conversations.latestMetadata(contact.id, WEB, 'intake'),
    ).toEqual({ answers: [{ id: 'name', value: 'Asha' }] });
    expect(b.metadata).toEqual({});
  });

  it('retention blanks the messages, the pre-chat answers and the display name past the cutoff', async () => {
    const contact = await conversations.resolveContact(
      { chatbotId: bot },
      WEB,
      'v',
      { displayName: 'Asha' },
    );
    const thread = await conversations.openConversation(bot, contact.id, WEB, {
      idleWindowMinutes: 60,
      now: new Date('2025-01-01T10:00:00Z'),
    });
    await conversations.appendMessage(thread.id, {
      channel: WEB,
      direction: WaMessageDirection.INBOUND,
      role: ConversationMessageRole.USER,
      text: 'my details',
      status: WaMessageStatus.SENT,
      createdAt: new Date('2025-01-01T10:00:00Z'),
    });
    await conversations.setMetadata(thread.id, {
      intake: { answers: [{ id: 'phone', value: '+91 98200' }] },
      other: 1,
    });

    const result = await conversations.blankBefore(
      new Date('2026-01-01T00:00:00Z'),
      PLACEHOLDERS,
    );
    expect(result.messages).toBe(1);
    const [conv] = await dataSource.query(
      `SELECT metadata FROM chatbot_conversations WHERE id = $1`,
      [thread.id],
    );
    expect(conv.metadata).toEqual({ other: 1 });
    const [person] = await dataSource.query(
      `SELECT display_name FROM chatbot_contacts WHERE id = $1`,
      [contact.id],
    );
    expect(person.display_name).toBeNull();
    const ids = await dataSource.query(
      `SELECT external_id FROM chatbot_contact_identities WHERE contact_id = $1`,
      [contact.id],
    );
    expect(
      ids.every((r: { external_id: string }) =>
        r.external_id.startsWith('erased:'),
      ),
    ).toBe(true);
  });

  it('erasing a web contact blanks every thread, the answers and every identity', async () => {
    const contact = await conversations.resolveVerifiedContact(
      { chatbotId: bot },
      { channel: EMAIL, externalId: 'asha@example.com' },
      { channel: WEB, externalId: 'v' },
    );
    const thread = await conversations.openConversation(bot, contact.id, WEB, {
      idleWindowMinutes: 60,
    });
    await say(thread.id, 'my phone is 98200');
    await conversations.setMetadata(thread.id, { intake: { answers: [] } });

    const { conversationIds } = await conversations.eraseContact(
      contact.id,
      PLACEHOLDERS,
    );
    expect(conversationIds).toEqual([thread.id]);
    const texts = await dataSource.query(
      `SELECT text FROM chatbot_messages WHERE conversation_id = $1`,
      [thread.id],
    );
    expect(texts).toEqual([{ text: '[erased]' }]);
    const [conv] = await dataSource.query(
      `SELECT metadata FROM chatbot_conversations WHERE id = $1`,
      [thread.id],
    );
    expect(conv.metadata).toEqual({});
    const ids = await dataSource.query(
      `SELECT external_id, verified FROM chatbot_contact_identities WHERE contact_id = $1`,
      [contact.id],
    );
    expect(ids).toHaveLength(2);
    expect(
      ids.every(
        (r: { external_id: string; verified: boolean }) =>
          r.external_id.startsWith('erased:') && !r.verified,
      ),
    ).toBe(true);
  });

  it('adding an email and an organisation to the page leaves WhatsApp’s canChat unchanged', async () => {
    const ORG = '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60';
    const [page] = await dataSource.query(
      `INSERT INTO chatbot_pages (chatbot_id, slug) VALUES ($1, 'sunrise') RETURNING id`,
      [bot],
    );
    await dataSource.query(
      `INSERT INTO chatbot_audience (chatbot_id, kind, value) VALUES ($1, $2, '+919820012345')`,
      [bot, ChatbotAudienceKind.PHONE],
    );
    const audience = new ChatbotAudienceService(
      dataSource.getRepository(ChatbotAudience),
    );
    const pageAccess = new BotPageAccessService(
      dataSource.getRepository(ChatbotPageAccess),
      dataSource,
    );
    const senders = [
      {
        externalId: '+919820012345',
        label: 'listed phone',
        phone: '+919820012345',
      },
      { externalId: 'a', label: 'invited email', email: 'asha@example.com' },
      { externalId: 'r', label: 'org member', tenantId: ORG, userId: 42 },
      { externalId: 'x', label: 'stranger' },
    ];
    const verdicts = () =>
      Promise.all(
        [
          ChatbotAccessMode.ANYONE,
          ChatbotAccessMode.RECOGNISED,
          ChatbotAccessMode.LISTED,
        ].flatMap((accessMode) =>
          senders.map((sender) =>
            audience.canChat({ id: bot, accessMode }, sender),
          ),
        ),
      );

    const before = await verdicts();
    await pageAccess.add(page.id, [
      { kind: BotPageAccessKind.EMAIL, value: 'asha@example.com' },
      { kind: BotPageAccessKind.ORGANISATION, value: ORG },
    ]);
    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM chatbot_audience WHERE chatbot_id = $1`,
      [bot],
    );
    expect(count).toBe(1);
    expect(await verdicts()).toEqual(before);
  });
});
