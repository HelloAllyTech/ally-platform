import { DEFAULT_WHATSAPP_SETTINGS } from 'src/whatsapp/type/whatsapp-settings.type';
import { WaHandledBy } from 'src/whatsapp/enum/whatsapp.enum';
import { Chatbot } from '../../entity/chatbot.entity';
import { AgentRuntimeUsed } from '../../enum/chatbot.enum';
import { ChatbotService } from '../chatbot.service';
import { buildChatbotService, storedBot } from './chatbot-service.fixtures';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * Agent mode on the chatbot API (Agents v2): Preview reports what the agent understood the message
 * to be.
 */
describe('ChatbotService and Agent mode', () => {
  let platformWide: boolean;
  let agentRuntimeAllowed: boolean;
  let stored: Chatbot;
  let updates: Partial<Chatbot>[];
  let respond: jest.Mock;
  let service: ChatbotService;

  beforeEach(() => {
    platformWide = false;
    agentRuntimeAllowed = true;
    updates = [];
    stored = storedBot();
    ({ service, respond } = buildChatbotService({
      platformWide: () => platformWide,
      agentRuntimeAllowed: () => agentRuntimeAllowed,
      stored: () => stored,
      onUpdate: (patch) => {
        updates.push(patch);
        stored = { ...stored, ...patch } as Chatbot;
      },
    }));
  });

  describe('Preview', () => {
    it('reports the turn type the agent understood', async () => {
      respond.mockResolvedValue({
        handledBy: WaHandledBy.RAG,
        body: 'Hi there!',
        citations: [],
        isWelcome: true,
        retrievalMeta: { turn_type: 'smalltalk' },
        turnType: 'smalltalk',
        agent: {
          runtime: AgentRuntimeUsed.V2,
          runId: 'run-1',
          conversationId: 'preview-x',
          trace: [],
        },
      });
      const result = await service.test('bot-1', { message: 'hi' });
      expect(result.turnType).toBe('smalltalk');
      // An empty chat stands for a new person: the agent's hello gets the notice too.
      expect(result.reply).toBe(
        `Hi there!\n\n${DEFAULT_WHATSAPP_SETTINGS.disclaimerText}`,
      );
      expect(respond.mock.calls[0][0].isFirstMessage).toBe(true);
    });

    it('is not a first message once the chat has history', async () => {
      await service.test('bot-1', {
        message: 'and then?',
        history: [{ role: 'user', content: 'hi' }],
      });
      expect(respond.mock.calls[0][0].isFirstMessage).toBe(false);
    });

    it('reports no turn type when the agent did not answer', async () => {
      const result = await service.test('bot-1', { message: 'q' });
      expect(result.turnType).toBeNull();
    });
  });
});
