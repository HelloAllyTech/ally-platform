import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { ChatbotPage } from '../../chatbot/entity/chatbot-page.entity';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotSettingsService } from '../../chatbot/service/chatbot-settings.service';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../whatsapp/type/whatsapp-settings.type';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../whatsapp/shared-store/test/shared-store.pg';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import { AssistantHomeService } from '../home/assistant-home.service';
import { versionOf } from '../home/home-fields';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => null,
    getExecutionId: () => undefined,
  },
}));

/**
 * The assistant home on real Postgres (chunk 20d): two tabs saving the same field at once are
 * serialised by the bot's row lock, so one wins and the other is told what it says now. Runs only
 * with CHATBOT_STORE_TEST_DB (see shared-store.pg.ts).
 */
describePg('Assistant home (Postgres)', () => {
  let dataSource: DataSource;
  let service: AssistantHomeService;
  let bot: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource([BotDraftEntity, ChatbotPage]);
    const settings = new ChatbotSettingsService(
      {
        findOne: async () => ({ value: DEFAULT_WHATSAPP_SETTINGS }),
      } as never,
      dataSource.getRepository(Chatbot),
    );
    const pages = new BotPageService(
      dataSource.getRepository(ChatbotPage),
      dataSource.getRepository(Chatbot),
      settings,
      {} as never,
      { botPage: { baseUrl: 'https://ally.example' } } as never,
    );
    service = new AssistantHomeService(
      dataSource,
      {
        assert: async (id: string) => ({
          chatbot: await dataSource
            .getRepository(Chatbot)
            .findOneByOrFail({ id }),
          role: ChatbotMemberRole.OWNER,
        }),
      } as never,
      pages,
      { findByChatbot: async () => null } as never,
      {} as never,
      {} as never,
    );
  });
  afterAll(async () => closeTestDataSource(dataSource));
  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(`TRUNCATE chatbot_pages CASCADE`);
    bot = await seedChatbot(dataSource, 'Sunrise Mind');
  });

  it('two tabs saving the same field at once: one wins, the other gets its value', async () => {
    const opened = (await service.get(bot)).fields.assistantName.version;
    const results = await Promise.allSettled(
      ['Asha', 'Meera'].map((value) =>
        service.saveField(bot, {
          field: 'assistantName',
          value,
          version: opened,
        }),
      ),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const winner = (won[0] as PromiseFulfilledResult<{ value: string }>).value
      .value;
    expect(lost[0].reason).toBeInstanceOf(ConflictException);
    expect(lost[0].reason.getResponse().details).toEqual({
      field: 'assistantName',
      value: winner,
      version: versionOf(winner),
    });

    // Both places hold the winner: the persona, and the page (created, off, by the save).
    const [row] = await dataSource.query(
      `SELECT c.persona->>'displayName' AS persona,
              p.settings->'branding'->>'assistantName' AS page, p.status
         FROM chatbots c JOIN chatbot_pages p ON p.chatbot_id = c.id
        WHERE c.id = $1`,
      [bot],
    );
    expect(row).toEqual({ persona: winner, page: winner, status: 'off' });
  });

  it('adds an own rule to the bot', async () => {
    await service.changeRule(bot, {
      op: 'add',
      text: 'Quote prices for group sessions',
      version: versionOf([]),
    });
    const [row] = await dataSource.query(
      `SELECT rules FROM chatbots WHERE id = $1`,
      [bot],
    );
    expect(row.rules.never).toEqual(['Quote prices for group sessions']);
  });
});
