import { ForbiddenException } from '@nestjs/common';
import { DEFAULT_WHATSAPP_SETTINGS } from 'src/whatsapp/type/whatsapp-settings.type';
import { WaHandledBy } from 'src/whatsapp/enum/whatsapp.enum';
import { Chatbot } from '../../entity/chatbot.entity';
import {
  AgentRuntimeUsed,
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotRuntime,
  ChatbotStatus,
} from '../../enum/chatbot.enum';
import { ChatbotAccessService } from '../chatbot-access.service';
import { ChatbotService } from '../chatbot.service';

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

  const countRepository = () => ({
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        addSelect: () => qb,
        where: () => qb,
        groupBy: () => qb,
        getRawMany: async () => [],
      };
      return qb;
    },
  });

  beforeEach(() => {
    platformWide = false;
    agentRuntimeAllowed = true;
    updates = [];
    stored = {
      id: 'bot-1',
      name: 'Ally FAQ',
      status: ChatbotStatus.LIVE,
      accessMode: ChatbotAccessMode.ANYONE,
      answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
      knowledgeSource: ChatbotKnowledgeSource.SELECTED,
      persona: {},
      model: null,
      settings: {},
      runtime: ChatbotRuntime.V2,
      features: {},
    } as Chatbot;
    const chatbotRepository = {
      findOne: jest.fn(async () => stored),
      find: jest.fn(async () => [stored]),
      update: jest.fn(async (_where: unknown, patch: Partial<Chatbot>) => {
        updates.push(patch);
        stored = { ...stored, ...patch } as Chatbot;
      }),
      manager: { query: jest.fn(async () => []) },
    };
    const access = new ChatbotAccessService(
      chatbotRepository as never,
      {
        findOne: jest.fn(async () => ({ role: 'owner' })),
        find: jest.fn(async () => [{ chatbotId: 'bot-1', role: 'owner' }]),
      } as never,
      {
        resolveTenantIds: jest.fn(async () =>
          platformWide ? null : ['org-a'],
        ),
      } as never,
    );
    const settings = () => ({
      ...DEFAULT_WHATSAPP_SETTINGS,
      agentRuntimeAllowed,
    });
    respond = jest.fn().mockResolvedValue({
      handledBy: WaHandledBy.RAG,
      body: 'Ally trains counsellors.',
      citations: [],
      agent: {
        runtime: AgentRuntimeUsed.V2,
        runId: 'run-1',
        conversationId: 'preview-x',
        trace: [{ node: 'retrieve', ms: 120, summary: '3 hits' }],
      },
    });
    service = new ChatbotService(
      chatbotRepository as never,
      countRepository() as never,
      countRepository() as never,
      countRepository() as never,
      {} as never,
      access,
      { summariesForBots: jest.fn(async () => new Map()) } as never,
      {
        get: jest.fn(async () => settings()),
        getForChatbot: jest.fn(async () => settings()),
        renderPlaceholders: (text: string) => text,
      } as never,
      { respond } as never,
      { getModels: jest.fn(async () => []) } as never,
    );
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
