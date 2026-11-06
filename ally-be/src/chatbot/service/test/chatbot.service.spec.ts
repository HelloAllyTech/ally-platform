import { WaHandledBy } from 'src/whatsapp/enum/whatsapp.enum';
import { Chatbot } from '../../entity/chatbot.entity';
import { AgentRuntimeUsed, ChatbotRuntime } from '../../enum/chatbot.enum';
import { ChatbotService } from '../chatbot.service';
import { buildChatbotService, storedBot } from './chatbot-service.fixtures';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * The Agents v2 engine switch on the chatbot API: GET says which engine actually answers, and
 * Preview reports the run behind a test.
 */
describe('ChatbotService and the runtime switch', () => {
  let agentRuntimeAllowed: boolean;
  let stored: Chatbot;
  let updates: Partial<Chatbot>[];
  let respond: jest.Mock;
  let service: ChatbotService;

  beforeEach(() => {
    agentRuntimeAllowed = true;
    updates = [];
    stored = storedBot();
    ({ service, respond } = buildChatbotService({
      agentRuntimeAllowed: () => agentRuntimeAllowed,
      stored: () => stored,
      onUpdate: (patch) => {
        updates.push(patch);
        stored = { ...stored, ...patch } as Chatbot;
      },
    }));
  });

  describe('PATCH', () => {
    it('leaves the fields to editors as before', async () => {
      await service.update('bot-1', { name: 'Renamed' });
      expect(updates[0]).toMatchObject({ name: 'Renamed' });
    });
  });

  describe('GET', () => {
    it('returns what actually answers, and no stored engine', async () => {
      const bot = await service.get('bot-1');
      expect(bot.effectiveRuntime).toBe(ChatbotRuntime.V2);
      expect(bot).not.toHaveProperty('runtime');
      expect(bot).not.toHaveProperty('features');
    });

    it('shows v1 as effective while the kill switch is off', async () => {
      agentRuntimeAllowed = false;
      await expect(service.get('bot-1')).resolves.toMatchObject({
        effectiveRuntime: ChatbotRuntime.V1,
      });
    });
  });

  describe('Preview', () => {
    it('reports the engine, the run and the trace', async () => {
      const result = await service.test('bot-1', {
        message: 'What does Ally do?',
        conversationId: 'preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11',
      });
      expect(result).toMatchObject({
        runtime: AgentRuntimeUsed.V2,
        runId: 'run-1',
        trace: [{ node: 'retrieve', ms: 120, summary: '3 hits' }],
        conversationId: 'preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11',
        runtimeAllowed: true,
      });
      expect(respond.mock.calls[0][0]).toMatchObject({
        channel: { type: 'test' },
        conversationId: 'preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11',
      });
    });

    it('starts a new Preview thread when none is given', async () => {
      const result = await service.test('bot-1', { message: 'hi' });
      expect(result.conversationId).toMatch(/^preview-[0-9a-f-]{36}$/);
    });

    it('reports v1 with no run when v1 answered', async () => {
      respond.mockResolvedValueOnce({ handledBy: WaHandledBy.RAG, body: 'x' });
      await expect(
        service.test('bot-1', { message: 'q' }),
      ).resolves.toMatchObject({ runtime: 'v1', runId: null, trace: null });
    });

    it('shows a fallback as the alert it would raise, without raising it', async () => {
      respond.mockResolvedValueOnce({
        handledBy: WaHandledBy.RAG,
        body: 'x',
        agent: {
          runtime: AgentRuntimeUsed.V2_FALLBACK,
          runId: 'run-2',
          conversationId: 'preview-x',
          fallbackReason: 'upstream_404',
        },
      });
      await expect(
        service.test('bot-1', { message: 'q' }),
      ).resolves.toMatchObject({
        runtime: AgentRuntimeUsed.V2_FALLBACK,
        fallbackReason: 'upstream_404',
        wouldAlert: 'Chatbot Agent Runtime Degraded',
      });
    });
  });
});
