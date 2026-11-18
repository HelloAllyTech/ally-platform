import { WaHandledBy } from 'src/whatsapp/enum/whatsapp.enum';
import { Chatbot } from '../../entity/chatbot.entity';
import { AgentRuntimeUsed } from '../../enum/chatbot.enum';
import { ChatbotService } from '../chatbot.service';
import { buildChatbotService, storedBot } from './chatbot-service.fixtures';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * The Agents v2 engine on the chatbot API: GET has no engine fields (Q3-fast: one run path), and
 * Preview reports the run behind a test.
 */
describe('ChatbotService and the agent run', () => {
  let stored: Chatbot;
  let updates: Partial<Chatbot>[];
  let respond: jest.Mock;
  let service: ChatbotService;

  beforeEach(() => {
    updates = [];
    stored = storedBot();
    ({ service, respond } = buildChatbotService({
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
    it('returns no engine fields: every bot answers the same way', async () => {
      const bot = await service.get('bot-1');
      expect(bot).not.toHaveProperty('effectiveRuntime');
      expect(bot).not.toHaveProperty('runtime');
      expect(bot).not.toHaveProperty('features');
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
      });
      expect(result).not.toHaveProperty('runtimeAllowed');
      expect(respond.mock.calls[0][0]).toMatchObject({
        channel: { type: 'test' },
        conversationId: 'preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11',
      });
    });

    it('starts a new Preview thread when none is given', async () => {
      const result = await service.test('bot-1', { message: 'hi' });
      expect(result.conversationId).toMatch(/^preview-[0-9a-f-]{36}$/);
    });

    it('reports no run when none was involved (a keyword reply)', async () => {
      respond.mockResolvedValueOnce({
        handledBy: WaHandledBy.TEMPLATE,
        body: 'x',
      });
      await expect(
        service.test('bot-1', { message: 'q' }),
      ).resolves.toMatchObject({ runtime: null, runId: null, trace: null });
    });

    it('shows a failed run as the alert it would raise, without raising it', async () => {
      respond.mockResolvedValueOnce({
        handledBy: WaHandledBy.RAG,
        body: 'x',
        agent: {
          runtime: AgentRuntimeUsed.V2_FAILED,
          runId: 'run-2',
          conversationId: 'preview-x',
          fallbackReason: 'upstream_404',
        },
      });
      await expect(
        service.test('bot-1', { message: 'q' }),
      ).resolves.toMatchObject({
        runtime: AgentRuntimeUsed.V2_FAILED,
        fallbackReason: 'upstream_404',
        wouldAlert: 'Chatbot Agent Runtime Degraded',
      });
    });
  });
});
