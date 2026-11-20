import { ChatbotService } from '../chatbot.service';

/**
 * The Overview's "Your numbers" (Q3d; prod 18 Nov): counted from the shared store, the one its
 * "This week" counts, whatever the WhatsApp dashboard reads. Before, the dashboard's default
 * (`wa_*`) left out every bot-page chat: "7 conversations" beside "People 0, Messages 0".
 */
describe('ChatbotService.statsFor', () => {
  const build = (dashboardReadsFrom: 'wa' | 'shared') => {
    const sql: string[] = [];
    const query = jest.fn(async (text: string) => {
      sql.push(text);
      return text.includes('wa_unanswered_questions')
        ? [{ chatbot_id: 'bot-1', open: '2' }]
        : [
            {
              chatbot_id: 'bot-1',
              messages: '12',
              people: '7',
              answered: '9',
              declined: '1',
              last_at: null,
            },
          ];
    });
    const settings = {
      get: async () => ({ sharedStoreWrites: true, dashboardReadsFrom }),
    };
    const service = new ChatbotService(
      { manager: { query } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, sql };
  };

  it.each(['wa', 'shared'] as const)(
    'reads chatbot_* when the dashboard reads %s',
    async (from) => {
      const { service, sql } = build(from);
      expect(await service.statsFor('bot-1', 7)).toMatchObject({
        people: 7,
        messages: 12,
        openUnanswered: 2,
      });
      expect(sql[0]).toContain('FROM chatbot_messages m');
      expect(sql[0]).toContain('JOIN chatbot_conversations c');
      expect(sql.join('\n')).not.toMatch(/wa_messages|wa_conversations/);
    },
  );
});
