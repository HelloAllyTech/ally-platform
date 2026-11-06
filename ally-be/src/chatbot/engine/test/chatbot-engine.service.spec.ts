import { AiUpstreamError } from '../../../ai/exception/ai-upstream.exception';
import { ErrorCode } from '../../../exception/error-code.enum';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { WhatsAppBotSettings } from '../../../whatsapp/type/whatsapp-settings.type';
import { Chatbot } from '../../entity/chatbot.entity';
import {
  AgentRuntimeUsed,
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotRuntime,
  ChatbotStatus,
} from '../../enum/chatbot.enum';
import { agentRunIdFor } from '../agent-runtime';
import { ChatbotEngineService } from '../chatbot-engine.service';
import type { ChatTurn } from '../chatbot-engine.types';

const bot = (over: Partial<Chatbot> = {}): Chatbot =>
  ({
    id: 'bot-1',
    name: 'Bot',
    status: ChatbotStatus.LIVE,
    accessMode: ChatbotAccessMode.ANYONE,
    answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
    knowledgeSource: ChatbotKnowledgeSource.SELECTED,
    persona: {
      displayName: ' Ally ',
      systemPrompt: 'Be brief.',
      tone: 'warm',
    },
    model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    settings: {},
    ...over,
  }) as Chatbot;

const ANSWER = {
  intent: 'answer',
  answer: 'Ally trains counsellors.',
  language: 'en',
  confidence: 0.8,
  citations: [
    {
      passage_number: 1,
      chunk_id: 'chunk-1',
      document_id: 'doc-1',
      document_title: 'Ally FAQ',
      similarity: 0.71,
    },
  ],
  decline_reason: 'none',
  retrieval: { hit_count: 3, top_similarity: 0.71, passages_used: 1 },
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  prompt_version: 'v1',
};

const TRACE = [
  { node: 'resolve_limits', ms: 0, summary: 'top_k=8' },
  { node: 'translate', ms: 1, summary: 'skipped' },
  { node: 'retrieve', ms: 120, summary: '3 hits' },
  { node: 'gate', ms: 0, summary: 'pass' },
  { node: 'select', ms: 0, summary: '1 passages' },
  { node: 'write', ms: 2100, summary: 'answer' },
  { node: 'finalize', ms: 0, summary: 'answer' },
];

const AGENT_ANSWER = {
  ...ANSWER,
  answer: 'Ally trains counsellors (v2).',
  retrieval: { ...ANSWER.retrieval, hit_chunk_ids: ['chunk-1', 'chunk-2'] },
  run_id: 'run-from-ally-ai',
  runtime: 'v2',
  trace: TRACE,
};

const upstream = (status: number, code: ErrorCode) =>
  new AiUpstreamError(
    `Request failed with status code ${status}`,
    code,
    status,
  );

/**
 * The engine on its own, with ally-ai and the Skills Store mocked.
 *
 * The first block pins the exact `/knowledge-agent/answer` body a v1 bot sends. It was written
 * against the engine BEFORE the Agents v2 runtime switch, so it is what proves the v1 request did
 * not change when the body moved into the shared builder.
 */
describe('ChatbotEngineService', () => {
  let engine: ChatbotEngineService;
  let aiService: {
    answerKnowledgeQuestion: jest.Mock;
    answerKnowledgeQuestionWithin: jest.Mock;
    checkWhatsAppCrisis: jest.Mock;
    runAgent: jest.Mock;
  };
  let promptShared: { getPromptsByOptions: jest.Mock };
  let settings: WhatsAppBotSettings;

  const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
    chatbot: bot(),
    settings,
    text: 'What does Ally do?',
    language: 'en',
    history: [{ role: 'user', content: 'hi' }],
    sender: { externalId: '919876543210', label: '…3210' },
    channel: { type: 'whatsapp' },
    ...over,
  });

  beforeEach(() => {
    settings = {
      ...DEFAULT_WHATSAPP_SETTINGS,
      retrieval: { ...DEFAULT_WHATSAPP_SETTINGS.retrieval },
    };
    aiService = {
      answerKnowledgeQuestion: jest.fn().mockResolvedValue(ANSWER),
      answerKnowledgeQuestionWithin: jest.fn().mockResolvedValue(ANSWER),
      runAgent: jest.fn().mockResolvedValue(AGENT_ANSWER),
      checkWhatsAppCrisis: jest
        .fn()
        .mockResolvedValue({ is_crisis: false, confidence: 0, signal: '' }),
    };
    promptShared = {
      getPromptsByOptions: jest.fn().mockResolvedValue([
        {
          promptCode: 'ally_ai_knowledge_whatsapp_answer',
          prompt: 'Answer from the passages.',
          version: 4,
          contentHash: 'h4',
          provider: 'openai',
          model: 'gpt-5-mini',
          temperature: 0.2,
        },
      ]),
    };
    engine = new ChatbotEngineService(
      {
        find: jest.fn().mockResolvedValue([{ documentId: 'doc-1' }]),
      } as never,
      { match: jest.fn().mockResolvedValue(null) } as never,
      { renderPlaceholders: (text: string) => text } as never,
      { canChat: jest.fn().mockResolvedValue(true) } as never,
      aiService as never,
      promptShared as never,
    );
  });

  describe('the v1 request body (snapshot)', () => {
    it('sends exactly these fields to /knowledge-agent/answer', async () => {
      await engine.respond(turn());

      expect(aiService.answerKnowledgeQuestion).toHaveBeenCalledTimes(1);
      expect(aiService.answerKnowledgeQuestion.mock.calls[0][0]).toEqual({
        question: 'What does Ally do?',
        history: [{ role: 'user', content: 'hi' }],
        prompts: {
          ally_ai_knowledge_whatsapp_answer: {
            prompt: 'Answer from the passages.',
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          },
          ally_ai_knowledge_answer_general: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          },
        },
        audience: { unrestricted: true },
        document_ids: ['doc-1'],
        persona: {
          display_name: 'Ally',
          system_prompt: 'Be brief.',
          tone: 'warm',
        },
        answer_mode: 'documents_only',
        channel: 'whatsapp',
        top_k: settings.retrieval.topK,
        min_similarity: settings.retrieval.minSimilarity,
        decline_similarity: settings.retrieval.declineSimilarity,
        max_passages: settings.retrieval.maxPassages,
        max_context_tokens: settings.retrieval.maxContextTokens,
        similarity_band: settings.retrieval.similarityBand,
        max_answer_chars: settings.maxAnswerChars,
        translate_query: settings.retrieval.translateQuery,
      });
    });

    it('sends the no-documents placeholder and an organisation audience as before', async () => {
      await engine.respond(turn({ documentIds: [] }));
      expect(
        aiService.answerKnowledgeQuestion.mock.calls[0][0].document_ids,
      ).toEqual(['00000000-0000-0000-0000-000000000000']);

      await engine.respond(
        turn({
          chatbot: bot({
            knowledgeSource: ChatbotKnowledgeSource.ORGANISATION,
            persona: {},
            model: null,
          }),
          sender: { externalId: 'x', label: 'x', tenantId: 'tenant-a' },
        }),
      );
      const body = aiService.answerKnowledgeQuestion.mock.calls[1][0];
      expect(body.audience).toEqual({
        tenant_id: 'tenant-a',
        include_global: true,
      });
      expect(body).not.toHaveProperty('document_ids');
      expect(body.persona).toBeUndefined();
    });

    it('runs the crisis check alongside with the same prompts', async () => {
      await engine.respond(turn());
      expect(aiService.checkWhatsAppCrisis).toHaveBeenCalledWith({
        message: 'What does Ally do?',
        prompts: aiService.answerKnowledgeQuestion.mock.calls[0][0].prompts,
      });
    });
  });

  describe('the runtime switch', () => {
    const allowed = (on = true) => {
      settings.agentRuntimeAllowed = on;
    };
    const whatsapp = (over: Partial<Chatbot> = {}) =>
      turn({
        chatbot: bot(over),
        conversationId: 'conv-1',
        providerMessageId: 'wamid.1',
      });

    it('answers v2 and shadow bots with v1 while the kill switch is off', async () => {
      allowed(false);
      for (const runtime of [ChatbotRuntime.V2, ChatbotRuntime.SHADOW]) {
        const decision = await engine.respond(whatsapp({ runtime }));
        expect(decision.agent).toBeUndefined();
        expect(decision.shadow).toBeUndefined();
      }
      expect(aiService.runAgent).not.toHaveBeenCalled();
      expect(aiService.answerKnowledgeQuestion).toHaveBeenCalledTimes(2);
    });

    it('lets the kill switch win over a forced v2 in Preview too', async () => {
      allowed(false);
      const decision = await engine.respond(
        turn({ runtime: ChatbotRuntime.V2, channel: { type: 'test' } }),
      );
      expect(aiService.runAgent).not.toHaveBeenCalled();
      expect(decision.agent).toBeUndefined();
    });

    it("follows the bot's own setting once the kill switch is on", async () => {
      allowed();
      await engine.respond(whatsapp({ runtime: ChatbotRuntime.V1 }));
      expect(aiService.runAgent).not.toHaveBeenCalled();
      await engine.respond(whatsapp({ runtime: ChatbotRuntime.V2 }));
      expect(aiService.runAgent).toHaveBeenCalledTimes(1);
    });

    it('lets Preview force v1 for one test of a v2 bot', async () => {
      allowed();
      await engine.respond({
        ...whatsapp({ runtime: ChatbotRuntime.V2 }),
        runtime: ChatbotRuntime.V1,
      });
      expect(aiService.runAgent).not.toHaveBeenCalled();
      expect(aiService.answerKnowledgeQuestion).toHaveBeenCalledTimes(1);
    });

    describe('a v2 bot', () => {
      beforeEach(() => allowed());

      it("calls /agent/run once with v1's body plus the run's four fields", async () => {
        const decision = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.V2 }),
        );

        // The v1 body, from the same bot on the same turn.
        allowed(false);
        await engine.respond(whatsapp({ runtime: ChatbotRuntime.V2 }));
        const v1Body = aiService.answerKnowledgeQuestion.mock.calls[0][0];

        expect(aiService.runAgent).toHaveBeenCalledTimes(1);
        expect(aiService.runAgent.mock.calls[0][0]).toEqual({
          ...v1Body,
          conversation_id: 'conv-1',
          run_id: agentRunIdFor('wamid.1'),
          chatbot_id: 'bot-1',
          runtime_version: 'v2',
        });
        expect(aiService.answerKnowledgeQuestion).toHaveBeenCalledTimes(1);
        expect(decision.body).toContain('(v2)');
        expect(decision.handledBy).toBe(WaHandledBy.RAG);
        expect(decision.agent).toEqual({
          runtime: AgentRuntimeUsed.V2,
          runId: 'run-from-ally-ai',
          conversationId: 'conv-1',
          trace: TRACE,
        });
      });

      it('does not call /knowledge-agent/answer when v2 answers', async () => {
        await engine.respond(whatsapp({ runtime: ChatbotRuntime.V2 }));
        expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
        expect(aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
      });

      it("keeps ally-ai's debug-only chunk list off the stored retrieval", async () => {
        const decision = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.V2 }),
        );
        expect(decision.retrievalMeta).not.toHaveProperty('hit_chunk_ids');
        expect(decision.retrievalMeta?.hit_count).toBe(3);
      });

      it.each([
        [
          'a 404 (runtime switched off)',
          upstream(404, ErrorCode.AI_REQUEST_REJECTED),
          'upstream_404',
        ],
        [
          'a 500',
          upstream(500, ErrorCode.AI_SERVICE_UNAVAILABLE),
          'upstream_500',
        ],
        [
          'a timeout',
          new AiUpstreamError(
            'timeout of 25000ms exceeded',
            ErrorCode.AI_SERVICE_TIMEOUT,
            undefined,
            'ECONNABORTED',
          ),
          'timeout',
        ],
        [
          'a refused connection',
          new AiUpstreamError(
            'connect ECONNREFUSED',
            ErrorCode.AI_SERVICE_UNAVAILABLE,
            undefined,
            'ECONNREFUSED',
          ),
          'unavailable',
        ],
      ])(
        'falls back to v1 exactly once on %s',
        async (_label, error, reason) => {
          aiService.runAgent.mockRejectedValueOnce(error);
          const decision = await engine.respond(
            whatsapp({ runtime: ChatbotRuntime.V2 }),
          );

          expect(aiService.runAgent).toHaveBeenCalledTimes(1);
          expect(aiService.answerKnowledgeQuestionWithin).toHaveBeenCalledTimes(
            1,
          );
          expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
          const [body, budget] =
            aiService.answerKnowledgeQuestionWithin.mock.calls[0];
          expect(body).not.toHaveProperty('run_id');
          expect(budget).toBeGreaterThan(30_000);
          expect(budget).toBeLessThanOrEqual(40_000);
          expect(decision.body).toContain('Ally trains counsellors.');
          expect(decision.body).not.toContain('(v2)');
          expect(decision.agent).toEqual({
            runtime: AgentRuntimeUsed.V2_FALLBACK,
            runId: agentRunIdFor('wamid.1'),
            conversationId: 'conv-1',
            fallbackReason: reason,
          });
        },
      );

      it('falls back on a 200 that is not an answer', async () => {
        aiService.runAgent.mockResolvedValueOnce({ detail: 'nope' });
        const decision = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.V2 }),
        );
        expect(aiService.answerKnowledgeQuestionWithin).toHaveBeenCalledTimes(
          1,
        );
        expect(decision.agent).toMatchObject({ fallbackReason: 'malformed' });
      });

      it('sends the fallback text, still linked to the run, when v1 fails too', async () => {
        aiService.runAgent.mockRejectedValueOnce(
          upstream(503, ErrorCode.AI_SERVICE_UNAVAILABLE),
        );
        aiService.answerKnowledgeQuestionWithin.mockRejectedValueOnce(
          new Error('ally-ai down'),
        );
        const decision = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.V2 }),
        );
        expect(decision.handledBy).toBe(WaHandledBy.ERROR);
        expect(decision.body).toBe(settings.fallbackText);
        expect(decision.agent?.runtime).toBe(AgentRuntimeUsed.V2_FALLBACK);
      });

      it('lets a crisis verdict override a v2 answer, keeping the run', async () => {
        aiService.checkWhatsAppCrisis.mockResolvedValueOnce({
          is_crisis: true,
          confidence: 0.9,
          signal: 'end it',
        });
        const decision = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.V2 }),
        );
        expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
        expect(decision.body).toBe(settings.crisisEscalationText);
        expect(decision.alert?.type).toBe('Chatbot Crisis Classifier');
        expect(decision.agent?.runId).toBe('run-from-ally-ai');
      });

      it('lets a crisis verdict override a fallback answer too', async () => {
        aiService.runAgent.mockRejectedValueOnce(
          upstream(404, ErrorCode.AI_REQUEST_REJECTED),
        );
        aiService.checkWhatsAppCrisis.mockResolvedValueOnce({
          is_crisis: true,
          confidence: 0.9,
          signal: 'end it',
        });
        const decision = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.V2 }),
        );
        expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
        expect(decision.agent?.runtime).toBe(AgentRuntimeUsed.V2_FALLBACK);
      });

      it('runs the crisis check once, alongside, with the same prompts', async () => {
        aiService.runAgent.mockRejectedValueOnce(
          upstream(404, ErrorCode.AI_REQUEST_REJECTED),
        );
        await engine.respond(whatsapp({ runtime: ChatbotRuntime.V2 }));
        expect(aiService.checkWhatsAppCrisis).toHaveBeenCalledTimes(1);
        expect(aiService.checkWhatsAppCrisis.mock.calls[0][0].prompts).toEqual(
          aiService.runAgent.mock.calls[0][0].prompts,
        );
      });

      it('gives Preview a fresh run id and its own thread', async () => {
        await engine.respond(
          turn({
            chatbot: bot({ runtime: ChatbotRuntime.V2 }),
            channel: { type: 'test' },
            conversationId: 'preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11',
          }),
        );
        await engine.respond(
          turn({
            chatbot: bot({ runtime: ChatbotRuntime.V2 }),
            channel: { type: 'test' },
          }),
        );
        const [first, second] = aiService.runAgent.mock.calls.map((c) => c[0]);
        expect(first.conversation_id).toBe(
          'preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11',
        );
        expect(second.conversation_id).toMatch(/^preview-[0-9a-f-]{36}$/);
        expect(first.run_id).not.toBe(second.run_id);
      });
    });

    describe('a shadow bot', () => {
      beforeEach(() => allowed());

      it('answers with v1 and hands back the comparison run without calling it', async () => {
        const decision = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.SHADOW }),
        );

        expect(aiService.runAgent).not.toHaveBeenCalled();
        expect(aiService.answerKnowledgeQuestion).toHaveBeenCalledTimes(1);
        expect(decision.agent).toBeUndefined();
        expect(decision.body).not.toContain('(v2)');
        expect(decision.shadow?.request).toEqual({
          ...aiService.answerKnowledgeQuestion.mock.calls[0][0],
          conversation_id: 'shadow-conv-1',
          run_id: agentRunIdFor('wamid.1'),
          chatbot_id: 'bot-1',
          runtime_version: 'v2',
          log_retrieval: false,
        });
        expect(decision.shadow?.v1).toEqual({
          intent: 'answer',
          decline_reason: 'none',
          cited_chunk_ids: ['chunk-1'],
          hit_count: 3,
          top_similarity: 0.71,
          latency_ms: expect.any(Number),
        });
      });

      it('never shadows in Preview', async () => {
        const decision = await engine.respond({
          ...whatsapp({ runtime: ChatbotRuntime.SHADOW }),
          channel: { type: 'test' },
        });
        expect(decision.shadow).toBeUndefined();
      });

      it('does not shadow a crisis reply or a failed answer', async () => {
        aiService.checkWhatsAppCrisis.mockResolvedValueOnce({
          is_crisis: true,
          confidence: 0.9,
          signal: 'x',
        });
        const crisis = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.SHADOW }),
        );
        aiService.answerKnowledgeQuestion.mockRejectedValueOnce(
          new Error('down'),
        );
        const failed = await engine.respond(
          whatsapp({ runtime: ChatbotRuntime.SHADOW }),
        );
        expect(crisis.shadow).toBeUndefined();
        expect(failed.shadow).toBeUndefined();
      });
    });
  });

  describe('agentRunIdFor', () => {
    it('derives the same run id from the same provider message id', () => {
      expect(agentRunIdFor('wamid.1')).toBe(agentRunIdFor('wamid.1'));
      expect(agentRunIdFor('wamid.1')).not.toBe(agentRunIdFor('wamid.2'));
      expect(agentRunIdFor('wamid.1')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('gives a fresh id when there is no provider message id', () => {
      expect(agentRunIdFor()).not.toBe(agentRunIdFor());
    });
  });
});
