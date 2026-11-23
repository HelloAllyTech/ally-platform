import { buildChatbotService } from './chatbot-service.fixtures';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/** Chunk 20a: a Draft bot whose setup is unfinished offers "Continue setup" to whoever started it. */
describe('ChatbotService: the caller’s unfinished setup', () => {
  it('lists the setup draft for the bot, asked for the caller only', async () => {
    const { service } = buildChatbotService();
    const query = (
      service as unknown as {
        chatbotRepository: { manager: { query: jest.Mock } };
      }
    ).chatbotRepository.manager.query;
    query.mockImplementation(async (sql: string, params: unknown[]) =>
      sql.includes('bot_drafts')
        ? [{ chatbot_id: (params[0] as string[])[0], id: 'draft-9' }]
        : [],
    );
    const [bot] = await service.list();
    expect(bot.setupDraftId).toBe('draft-9');
    const call = query.mock.calls.find(([sql]) =>
      String(sql).includes('bot_drafts'),
    );
    expect(call?.[1]?.[1]).toBe(7);
    expect(String(call?.[0])).toContain("status = 'active'");
  });

  it('is null for a bot with no setup in progress', async () => {
    const { service } = buildChatbotService();
    const [bot] = await service.list();
    expect(bot.setupDraftId).toBeNull();
  });
});
