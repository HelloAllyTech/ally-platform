import { DataSource } from 'typeorm';
import { ChatbotConversation } from 'src/chatbot/entity/chatbot-conversation.entity';
import { ChatbotMessage } from 'src/chatbot/entity/chatbot-message.entity';
import {
  ConversationChannel,
  ConversationMessageRole,
} from 'src/chatbot/enum/conversation.enum';
import { ChatbotService } from 'src/chatbot/service/chatbot.service';
import { ConversationService } from 'src/chatbot/service/conversation.service';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import {
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
  WaUnansweredReason,
  WaUnansweredStatus,
} from '../../enum/whatsapp.enum';
import { WhatsAppConversationService } from '../../service/whatsapp-conversation.service';
import {
  DEFAULT_WHATSAPP_SETTINGS,
  WhatsAppBotSettings,
} from '../../type/whatsapp-settings.type';
import { backfillSharedStore } from '../wa-shared-store.backfill';
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

/** What only the shared store adds: the channel, and a bot page visitor's label. */
const strip = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (key, v) =>
      key === 'channel' || key === 'visitor' ? undefined : v,
    ),
  );

/**
 * Chunk 12b's promise: for the same WhatsApp data, the dashboard shows exactly what it showed
 * before when it reads the shared store. Real WhatsApp traffic goes through the real inbound
 * handler, the backfill copies it, and every view is read both ways and compared.
 */
describePg(
  'Dashboard on the shared store: WhatsApp views unchanged (Postgres)',
  () => {
    let dataSource: DataSource;
    let conversations: ConversationService;
    let settings: WhatsAppBotSettings;
    let dashboard: WhatsAppConversationService;
    let chatbots: ChatbotService;
    let botA: string;
    let botB: string;

    const asWa = () =>
      (settings = {
        ...settings,
        sharedStoreWrites: true,
        dashboardReadsFrom: 'wa',
      });
    const asShared = () =>
      (settings = {
        ...settings,
        sharedStoreWrites: true,
        dashboardReadsFrom: 'shared',
      });
    const both = async <T>(
      read: () => Promise<T>,
    ): Promise<{ wa: T; shared: T }> => {
      asWa();
      const wa = await read();
      asShared();
      const shared = await read();
      return { wa, shared };
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
      botA = await seedChatbot(dataSource, 'A');
      botB = await seedChatbot(dataSource, 'B');
      settings = { ...DEFAULT_WHATSAPP_SETTINGS };
      const settingsService = { get: async () => settings };
      const unused = undefined as never;
      dashboard = new WhatsAppConversationService(
        dataSource.getRepository(WaContact),
        dataSource.getRepository(WaConversation),
        dataSource.getRepository(WaMessage),
        dataSource.getRepository(WaUnansweredQuestion),
        dataSource.getRepository(Tenant),
        {} as never,
        {} as never,
        { accessibleChatbotIds: async () => null } as never,
        conversations,
        settingsService as never,
      );
      chatbots = new ChatbotService(
        { manager: dataSource.manager } as never,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        settingsService as never,
        unused,
        unused,
        unused,
      );

      const repositories = {
        contacts: dataSource.getRepository(WaContact),
        conversations: dataSource.getRepository(WaConversation),
        messages: dataSource.getRepository(WaMessage),
        unanswered: dataSource.getRepository(WaUnansweredQuestion),
      };
      const harness = (chatbotId: string, decision = {}) =>
        buildInboundHarness({ repositories, chatbotId, decision });
      const answered = harness(botA);
      const declined = harness(botA, {
        handledBy: WaHandledBy.DECLINED,
        body: 'My material does not cover that.',
        language: 'hi',
        unanswered: {
          reason: WaUnansweredReason.BELOW_THRESHOLD,
          topSimilarity: 0.3,
          hitCount: 2,
        },
      });
      // Three people on bot A with 1, 2 and 3 messages (distinct counts, so sorting is stable), one on B.
      await answered.inbound('how do I get access?', '919800000001');
      await answered.inbound('and after that?', '919800000002');
      await declined.inbound('kya fees hai?', '919800000002');
      await answered.inbound('hello', '919800000003');
      await declined.inbound('parking?', '919800000003');
      await answered.inbound('thanks', '919800000003');
      await harness(botB).inbound('hi from B', '919800000009');
      await backfillSharedStore(dataSource);
    });

    it.each([
      ['everything', {}],
      ['one bot', { chatbotId: 'A' }],
      ['declined only', { chatbotId: 'A', declinedOnly: true }],
      ['handled by rag', { handledBy: WaHandledBy.RAG }],
      ['a language', { language: 'hi' }],
      ['a search', { search: 'FEES' }],
      [
        'a date window',
        {
          from: new Date(Date.now() - 3_600_000),
          to: new Date(Date.now() + 3_600_000),
        },
      ],
      [
        'sorted by start, oldest first',
        { sortBy: 'startedAt', sortDir: 'asc' },
      ],
      ['sorted by size', { sortBy: 'messageCount', sortDir: 'desc' }],
      ['paged', { limit: 2, offset: 1 }],
    ])(
      'listConversations: %s',
      async (_label, options: Record<string, unknown>) => {
        const query = {
          ...options,
          chatbotId: options.chatbotId === 'A' ? botA : undefined,
        };
        const { wa, shared } = await both(() =>
          dashboard.listConversations(query),
        );
        expect(wa.count).toBeGreaterThan(0);
        expect(strip(shared)).toEqual(strip(wa));
        expect(
          (shared.conversations as { channel?: string }[]).every(
            (c) => c.channel === 'whatsapp',
          ),
        ).toBe(true);
      },
    );

    it('listLanguages', async () => {
      const all = await both(() => dashboard.listLanguages());
      expect(all.shared).toEqual(all.wa);
      const one = await both(() => dashboard.listLanguages(botA));
      expect(one.shared).toEqual(one.wa);
    });

    it('getConversation, for every thread', async () => {
      asWa();
      const { conversations: threads } = await dashboard.listConversations({});
      for (const thread of threads as { id: string }[]) {
        const { wa, shared } = await both(() =>
          dashboard.getConversation(thread.id),
        );
        expect(strip(shared)).toEqual(strip(wa));
        expect((shared as { channel?: string }).channel).toBe('whatsapp');
      }
    });

    it('listUnanswered', async () => {
      for (const options of [
        {},
        { chatbotId: botA },
        { chatbotId: botB },
        { status: WaUnansweredStatus.ANSWERED },
      ]) {
        const { wa, shared } = await both(() =>
          dashboard.listUnanswered(options),
        );
        expect(strip(shared)).toEqual(strip(wa));
      }
    });

    it('bot stats', async () => {
      const stats = (
        chatbots as unknown as {
          stats: (ids: string[]) => Promise<Map<string, unknown>>;
        }
      ).stats.bind(chatbots);
      const { wa, shared } = await both(() => stats([botA, botB]));
      expect([...shared.entries()]).toEqual([...wa.entries()]);
      expect(wa.get(botA)).toMatchObject({
        messages: 6,
        people: 3,
        declined: 2,
        openUnanswered: 2,
      });
    });

    describe('with a bot page chat as well', () => {
      let webThread: string;

      beforeEach(async () => {
        const contact = await conversations.resolveVerifiedContact(
          { chatbotId: botA },
          {
            channel: ConversationChannel.EMAIL,
            externalId: 'asha@example.com',
          },
          { channel: ConversationChannel.WEB, externalId: 'visitor-1' },
        );
        const thread = await conversations.openConversation(
          botA,
          contact.id,
          ConversationChannel.WEB,
          {
            idleWindowMinutes: 60,
          },
        );
        webThread = thread.id;
        await conversations.setMetadata(thread.id, {
          intake: {
            completedAt: 'x',
            answers: [
              { id: 'name', label: 'Your name', type: 'text', value: 'Asha' },
            ],
            consents: [],
          },
        });
        const inbound = await conversations.appendMessage(thread.id, {
          channel: ConversationChannel.WEB,
          direction: WaMessageDirection.INBOUND,
          role: ConversationMessageRole.USER,
          text: 'do you take insurance?',
          status: WaMessageStatus.SENT,
          handledBy: WaHandledBy.DECLINED,
        });
        await conversations.appendMessage(thread.id, {
          channel: ConversationChannel.WEB,
          direction: WaMessageDirection.OUTBOUND,
          role: ConversationMessageRole.ASSISTANT,
          text: 'My material does not cover that.',
          status: WaMessageStatus.SENT,
          handledBy: WaHandledBy.DECLINED,
          language: 'en',
        });
        await dataSource.query(
          `INSERT INTO wa_unanswered_questions (message_id, conversation_id, question_text, reason, hit_count)
         VALUES ($1, $2, 'do you take insurance?', 'model_declined', 0)`,
          [inbound.id, thread.id],
        );
      });

      it('appears with its channel and masked visitor in shared mode, and the WhatsApp rows are unchanged', async () => {
        asShared();
        const all = await dashboard.listConversations({ chatbotId: botA });
        const web = (all.conversations as Record<string, unknown>[]).find(
          (c) => c.id === webThread,
        );
        expect(web).toMatchObject({
          channel: 'web',
          visitor: 'a***@example.com',
          messageCount: 1,
          lastLanguage: 'en',
          phoneLast4: null,
        });
        const whatsapp = await dashboard.listConversations({
          chatbotId: botA,
          channel: 'whatsapp',
        });
        asWa();
        const before = await dashboard.listConversations({ chatbotId: botA });
        expect(strip(whatsapp)).toEqual(strip(before));
        const onlyWeb = await (asShared(),
        dashboard.listConversations({ chatbotId: botA, channel: 'web' }));
        expect(onlyWeb.count).toBe(1);
      });

      it('is not listed, nor its question queued, while the dashboard reads wa_*', async () => {
        asWa();
        const list = await dashboard.listConversations({});
        expect(
          (list.conversations as { id: string }[]).map((c) => c.id),
        ).not.toContain(webThread);
        expect(
          (await dashboard.listConversations({ channel: 'web' })).count,
        ).toBe(0);
        const queue = await dashboard.listUnanswered({});
        expect(queue.questions.map((q) => q.conversationId)).not.toContain(
          webThread,
        );
      });

      it('shows its pre-chat answers and messages in the detail', async () => {
        asShared();
        const detail = (await dashboard.getConversation(webThread)) as Record<
          string,
          any
        >;
        expect(detail.channel).toBe('web');
        expect(detail.conversation.intake.answers[0]).toMatchObject({
          label: 'Your name',
          value: 'Asha',
        });
        expect(detail.visitor.label).toBe('a***@example.com');
        expect(detail.messages.map((m: { body: string }) => m.body)).toEqual([
          'do you take insurance?',
          'My material does not cover that.',
        ]);
      });

      it('queues its unanswered question with its channel, and counts it in the bot’s stats', async () => {
        asShared();
        const queue = await dashboard.listUnanswered({ chatbotId: botA });
        const web = queue.questions.find(
          (q) => q.conversationId === webThread,
        ) as unknown as Record<string, unknown>;
        expect(web.channel).toBe('web');
        const stats = await (
          chatbots as unknown as {
            stats: (
              ids: string[],
            ) => Promise<
              Map<string, { openUnanswered: number; people: number }>
            >;
          }
        ).stats([botA]);
        expect(stats.get(botA)).toMatchObject({ openUnanswered: 3, people: 4 });
      });

      it('erases the visitor from the dashboard', async () => {
        asShared();
        const detail = (await dashboard.getConversation(webThread)) as Record<
          string,
          any
        >;
        await dashboard.eraseWebContact(detail.visitor.id);
        const after = (await dashboard.getConversation(webThread)) as Record<
          string,
          any
        >;
        expect(
          after.messages.every((m: { body: string }) => m.body === '[erased]'),
        ).toBe(true);
        expect(after.conversation.intake).toBeNull();
        const [q] = await dataSource.query(
          `SELECT question_text FROM wa_unanswered_questions WHERE conversation_id = $1`,
          [webThread],
        );
        expect(q.question_text).toBe('[erased]');
      });
    });
  },
);
