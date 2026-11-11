import { DataSource } from 'typeorm';
import { BotPageAccessService } from '../../chatbot/bot-page/bot-page-access.service';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { ChatbotPageAccess } from '../../chatbot/entity/chatbot-page-access.entity';
import { ChatbotPage } from '../../chatbot/entity/chatbot-page.entity';
import { ChatbotSettingsService } from '../../chatbot/service/chatbot-settings.service';
import {
  DEFAULT_WHATSAPP_SETTINGS,
  WhatsAppBotSettings,
} from '../../whatsapp/type/whatsapp-settings.type';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../whatsapp/shared-store/test/shared-store.pg';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import {
  BotDraftActor,
  BotDraftStep,
  SafetyPackId,
} from '../enum/bot-draft.enum';
import { SAFETY_PACKS } from '../safety-pack/safety-packs';
import { BotDraftPublishService } from '../service/bot-draft-publish.service';
import { BotDraftService } from '../service/bot-draft.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => null,
    getExecutionId: () => undefined,
  },
}));

/**
 * Chunk 20a on real Postgres: the draft's versioned writes leave the crawl's progress and the
 * documents it added alone, and publishing twice converges one chatbot, one page and one access
 * list. Runs only with CHATBOT_STORE_TEST_DB (see shared-store.pg.ts).
 */
describePg('Onboarding drafts (Postgres)', () => {
  let dataSource: DataSource;
  let drafts: BotDraftService;
  let publisher: BotDraftPublishService;
  let bot: string;
  let globals: WhatsAppBotSettings;
  const knowledge = {
    createForChatbot: jest.fn(async () => ({
      id: '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60',
    })),
    updateForChatbot: jest.fn(async () => ({})),
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource([
      BotDraftEntity,
      ChatbotPage,
      ChatbotPageAccess,
    ]);
    const events = { publish: jest.fn(async () => undefined) };
    drafts = new BotDraftService(
      dataSource.getRepository(BotDraftEntity),
      dataSource,
      { isPlatformAdmin: async () => false } as never,
      events as never,
    );
    const settings = new ChatbotSettingsService(
      { findOne: async () => ({ value: globals }) } as never,
      dataSource.getRepository(Chatbot),
    );
    const botPages = new BotPageService(
      dataSource.getRepository(ChatbotPage),
      dataSource.getRepository(Chatbot),
      settings,
      {} as never,
      { botPage: { baseUrl: 'https://ally.example' } } as never,
    );
    publisher = new BotDraftPublishService(
      drafts,
      events as never,
      {
        assert: async (id: string) => ({
          chatbot: await dataSource
            .getRepository(Chatbot)
            .findOneByOrFail({ id }),
        }),
      } as never,
      settings,
      botPages,
      new BotPageAccessService(
        dataSource.getRepository(ChatbotPageAccess),
        dataSource,
      ),
      knowledge as never,
      dataSource.getRepository(Chatbot),
    );
  });
  afterAll(async () => closeTestDataSource(dataSource));
  beforeEach(async () => {
    globals = { ...DEFAULT_WHATSAPP_SETTINGS, crisisClassifierEnabled: false };
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE bot_drafts, chatbot_pages, chatbot_page_access, chatbot_documents CASCADE`,
    );
    bot = await seedChatbot(dataSource, 'Sunrise Mind');
    await dataSource.query(
      `UPDATE chatbots SET status = 'draft' WHERE id = $1`,
      [bot],
    );
    knowledge.createForChatbot.mockClear();
  });

  async function seedDraft(step = BotDraftStep.LEARNED) {
    const config = {
      ...BotDraftService.defaultDraft('Sunrise Mind'),
      assistantName: 'Sunrise assistant',
      introduction: 'Hi, I’m the Sunrise assistant.',
      instructions: 'You answer questions about Sunrise Mind.',
      ownerNotes: 'Your fees: ₹2,000 a session.',
      safetyPackId: SafetyPackId.MENTAL_HEALTH,
      extraNever: ['Quote prices for group sessions'],
    };
    // As setSafety leaves it: a health pack's disclaimer on the page.
    config.branding = {
      ...config.branding,
      disclaimer: SAFETY_PACKS[SafetyPackId.MENTAL_HEALTH].disclaimer!,
    };
    const saved = await dataSource.getRepository(BotDraftEntity).save({
      ownerUserId: 7,
      step,
      source: { website: 'https://sunrise.example/' },
      crawl: {
        status: 'running',
        queue: [],
        seen: [],
        pages: [],
        findings: [],
      },
      learned: { facts: [], dropped: 0 },
      safetyPack: SafetyPackId.MENTAL_HEALTH,
      safetyPackVersion: 1,
      draftConfig: config,
      chatbotId: bot,
    } as Partial<BotDraftEntity>);
    return (await drafts.findById(saved.id))!;
  }

  it('an edit made from an older read keeps the crawl’s progress and the documents it added', async () => {
    const draft = await seedDraft();
    // The crawl moves on in the background, without a version bump.
    await drafts.saveCrawl(draft.id, {
      ...draft.crawl,
      pages: [
        { url: 'https://sunrise.example/', title: 'Home', status: 'read' },
      ],
    });
    await drafts.addKnowledgeDocument(
      draft.id,
      '11111111-1111-4111-8111-111111111111',
    );
    // An edit based on the draft as read before that.
    await drafts.applyPatch(
      draft,
      [{ op: 'replace', path: '/tone', value: 'formal' }],
      BotDraftActor.OWNER,
      { target: 'draft' },
    );
    const row = (await drafts.findById(draft.id))!;
    expect(row.draftConfig.tone).toBe('formal');
    expect(row.crawl.pages).toHaveLength(1);
    expect(row.draftConfig.knowledgeDocumentIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('a stale write is refused, not merged', async () => {
    const draft = await seedDraft();
    await drafts.applyPatch(
      draft,
      [{ op: 'replace', path: '/tone', value: 'formal' }],
      BotDraftActor.OWNER,
      { target: 'draft' },
    );
    await expect(
      drafts.applyPatch(
        draft,
        [{ op: 'replace', path: '/tone', value: 'friendly' }],
        BotDraftActor.OWNER,
        { target: 'draft' },
      ),
    ).rejects.toMatchObject({ response: { errorCode: 'stale_version' } });
  });

  it('publishing twice converges one live chatbot, one page and one access list', async () => {
    const draft = await seedDraft(BotDraftStep.SHARE);
    const dto = {
      access: 'invite' as const,
      emails: ['asha@example.com', 'ravi@example.com'],
    };
    const first = await publisher.publish(draft, dto);
    const again = await publisher.publish(
      (await drafts.findById(draft.id))!,
      dto,
    );

    expect(again.link).toBe(first.link);
    expect(first.link).toBe(`https://ally.example/b/${first.slug}`);
    const pages = await dataSource.query(
      `SELECT id, status, access, settings FROM chatbot_pages WHERE chatbot_id = $1`,
      [bot],
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ status: 'on', access: 'invite' });
    const entries = await dataSource.query(
      `SELECT kind, value FROM chatbot_page_access WHERE page_id = $1 ORDER BY value`,
      [pages[0].id],
    );
    expect(entries).toEqual([
      { kind: 'email', value: 'asha@example.com' },
      { kind: 'email', value: 'ravi@example.com' },
    ]);
    const [chatbot] = await dataSource.query(
      `SELECT status, safety_pack, safety_pack_version, rules, persona, settings FROM chatbots WHERE id = $1`,
      [bot],
    );
    expect(chatbot).toMatchObject({
      status: 'live',
      safety_pack: 'mental_health',
      safety_pack_version: 1,
      rules: { never: ['Quote prices for group sessions'] },
    });
    expect(chatbot.persona.systemPrompt).toBe(
      'You answer questions about Sunrise Mind.',
    );
    expect(chatbot.settings.crisisClassifierEnabled).toBe(true);
    expect(knowledge.createForChatbot).toHaveBeenCalledTimes(1);
    const documents = await dataSource.query(
      `SELECT document_id FROM chatbot_documents WHERE chatbot_id = $1`,
      [bot],
    );
    expect(documents).toHaveLength(1);
    const row = (await drafts.findById(draft.id))!;
    expect(row.status).toBe('published');
    expect(row.events.filter((e) => e.kind === 'publish')).toHaveLength(2);
  });

  it('public is refused while the platform has it off, and nothing is written', async () => {
    const draft = await seedDraft(BotDraftStep.SHARE);
    await expect(
      publisher.publish(draft, { access: 'public' }),
    ).rejects.toThrow('Public links are turned off');
    const [chatbot] = await dataSource.query(
      `SELECT status FROM chatbots WHERE id = $1`,
      [bot],
    );
    expect(chatbot.status).toBe('draft');
  });
});
