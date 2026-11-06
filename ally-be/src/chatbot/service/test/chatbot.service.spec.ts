import { ForbiddenException } from '@nestjs/common';
import { WaHandledBy } from 'src/whatsapp/enum/whatsapp.enum';
import { Chatbot } from '../../entity/chatbot.entity';
import { AgentRuntimeUsed, ChatbotRuntime } from '../../enum/chatbot.enum';
import { ChatbotService } from '../chatbot.service';
import { buildChatbotService, storedBot } from './chatbot-service.fixtures';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * The Agents v2 engine switch on the chatbot API: only a platform admin chooses or compares
 * engines, GET says which engine actually answers, and Preview reports the run behind a test.
 */
describe('ChatbotService and the runtime switch', () => {
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

  describe('PATCH runtime', () => {
    it('refuses anyone but a platform admin, even a bot owner', async () => {
      await expect(
        service.update('bot-1', { runtime: ChatbotRuntime.V1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(updates).toEqual([]);
    });

    it('lets a platform admin set it', async () => {
      platformWide = true;
      const bot = await service.update('bot-1', {
        runtime: ChatbotRuntime.SHADOW,
      });
      expect(updates[0]).toMatchObject({ runtime: ChatbotRuntime.SHADOW });
      expect(bot.runtime).toBe(ChatbotRuntime.SHADOW);
    });

    it('leaves the other fields to editors as before', async () => {
      await service.update('bot-1', { name: 'Renamed' });
      expect(updates[0]).toMatchObject({ name: 'Renamed' });
      expect(updates[0]).not.toHaveProperty('runtime');
    });
  });

  describe('GET', () => {
    it('returns the runtime, the features and what actually answers', async () => {
      await expect(service.get('bot-1')).resolves.toMatchObject({
        runtime: ChatbotRuntime.V2,
        effectiveRuntime: ChatbotRuntime.V2,
        features: {},
      });
    });

    it('shows v1 as effective while the kill switch is off', async () => {
      agentRuntimeAllowed = false;
      await expect(service.get('bot-1')).resolves.toMatchObject({
        runtime: ChatbotRuntime.V2,
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

    it('lets only a platform admin force an engine for one test', async () => {
      await expect(
        service.test('bot-1', { message: 'q', runtime: ChatbotRuntime.V1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(respond).not.toHaveBeenCalled();

      platformWide = true;
      await service.test('bot-1', { message: 'q', runtime: ChatbotRuntime.V1 });
      expect(respond.mock.calls[0][0].runtime).toBe(ChatbotRuntime.V1);
    });
  });
});
