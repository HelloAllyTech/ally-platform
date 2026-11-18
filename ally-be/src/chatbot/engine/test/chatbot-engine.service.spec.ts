import { GENERAL_CRISIS_TEXT } from '../../../bot-draft/safety-pack/safety-packs';
import type { AgentRunResponse } from '../../../ai/dto/knowledge.dto';
import { AiUpstreamError } from '../../../ai/exception/ai-upstream.exception';
import { ErrorCode } from '../../../exception/error-code.enum';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { WhatsAppBotSettings } from '../../../whatsapp/type/whatsapp-settings.type';
import { Chatbot } from '../../entity/chatbot.entity';
import {
  AgentRuntimeUsed,
  ChatbotKnowledgeSource,
} from '../../enum/chatbot.enum';
import { agentRunIdFor } from '../agent-runtime';
import { ChatbotEngineService } from '../chatbot-engine.service';
import type { ChatTurn } from '../chatbot-engine.types';
import {
  ANSWER,
  chatbotFixture,
  type EngineAiService,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const bot = (over: Partial<Chatbot> = {}): Chatbot =>
  chatbotFixture({
    persona: {
      displayName: ' Ally ',
      systemPrompt: 'Be brief.',
      tone: 'warm',
    },
    model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ...over,
  });

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
} satisfies AgentRunResponse;

const upstream = (status: number, code: ErrorCode) =>
  new AiUpstreamError(
    `Request failed with status code ${status}`,
    code,
    status,
  );

/**
 * The engine on its own, with ally-ai and the Skills Store mocked.
 *
 * The first block pins the knowledge fields every answer sends. They were v1's request body, and
 * since Q3-fast (one path, no v1) they travel inside `/agent/run`'s body unchanged.
 */
describe('ChatbotEngineService', () => {
  let engine: ChatbotEngineService;
  let aiService: EngineAiService;
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
    aiService = engineAiService(ANSWER, AGENT_ANSWER);
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
    engine = makeEngine({ aiService, promptShared });
  });

  describe('the request every answer sends (snapshot)', () => {
    it('sends the knowledge fields, unchanged since v1, inside /agent/run', async () => {
      await engine.respond(turn());

      expect(aiService.runAgent).toHaveBeenCalledTimes(1);
      expect(aiService.runAgent.mock.calls[0][0]).toMatchObject({
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
          ally_ai_agent_system: {
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
        runtime_version: 'v2',
        chatbot_id: 'bot-1',
        knowledge_topics: [],
        decline_text: settings.declineText,
      });
    });

    it('sends the no-documents placeholder and an organisation audience as before', async () => {
      await engine.respond(turn({ documentIds: [] }));
      expect(aiService.runAgent.mock.calls[0][0].document_ids).toEqual([
        '00000000-0000-0000-0000-000000000000',
      ]);

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
      const body = aiService.runAgent.mock.calls[1][0];
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
        // The person's earlier messages (chunk 15a).
        history: ['hi'],
        prompts: aiService.runAgent.mock.calls[0][0].prompts,
      });
    });
  });

  describe('one run path, no v1 (Q3-fast Part 0)', () => {
    const whatsapp = (over: Partial<Chatbot> = {}) =>
      turn({
        chatbot: bot(over),
        conversationId: 'conv-1',
        providerMessageId: 'wamid.1',
      });
    const RUN_FAILED =
      "Sorry, I couldn't answer that just now. Please try again.";

    it('answers every channel through /agent/run, never /knowledge-agent/answer', async () => {
      for (const type of ['whatsapp', 'test', 'web'] as const) {
        await engine.respond(turn({ channel: { type } }));
      }
      expect(aiService.runAgent).toHaveBeenCalledTimes(3);
      expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
      expect(aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
    });

    it('calls /agent/run once with the run fields and records the run', async () => {
      const decision = await engine.respond(whatsapp());

      expect(aiService.runAgent).toHaveBeenCalledTimes(1);
      expect(aiService.runAgent.mock.calls[0][0]).toMatchObject({
        conversation_id: 'conv-1',
        run_id: agentRunIdFor('wamid.1'),
        chatbot_id: 'bot-1',
        runtime_version: 'v2',
      });
      expect(decision.body).toContain('(v2)');
      expect(decision.handledBy).toBe(WaHandledBy.RAG);
      expect(decision.agent).toEqual({
        runtime: AgentRuntimeUsed.V2,
        runId: 'run-from-ally-ai',
        conversationId: 'conv-1',
        trace: TRACE,
      });
    });

    it("keeps ally-ai's debug-only chunk list off the stored retrieval", async () => {
      const decision = await engine.respond(whatsapp());
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
      'sends the fixed run-failed reply on %s, never v1',
      async (_label, error, reason) => {
        aiService.runAgent.mockRejectedValueOnce(error);
        const decision = await engine.respond(whatsapp());

        expect(aiService.runAgent).toHaveBeenCalledTimes(1);
        expect(aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
        expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
        expect(decision.handledBy).toBe(WaHandledBy.ERROR);
        expect(decision.body).toBe(RUN_FAILED);
        expect(decision.body).not.toBe(settings.fallbackText);
        expect(decision.unanswered?.reason).toBe('error');
        expect(decision.agent).toEqual({
          runtime: AgentRuntimeUsed.V2_FAILED,
          runId: agentRunIdFor('wamid.1'),
          conversationId: 'conv-1',
          fallbackReason: reason,
        });
      },
    );

    it('sends the run-failed reply on a 200 that is not an answer', async () => {
      aiService.runAgent.mockResolvedValueOnce({ detail: 'nope' });
      const decision = await engine.respond(whatsapp());
      expect(aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
      expect(decision.body).toBe(RUN_FAILED);
      expect(decision.agent).toMatchObject({ fallbackReason: 'malformed' });
    });

    it("names the business's sourced contact, in the person's language", async () => {
      const query = jest.fn().mockResolvedValue([
        {
          learned: {
            facts: [
              { section: 'services', text: 'Therapy from Rs 1,500.' },
              {
                section: 'location',
                text: 'Call us on +91 22 6849 3328 or write to hello@ally.test.',
              },
            ],
          },
        },
      ]);
      engine = makeEngine({
        aiService,
        promptShared,
        documents: {
          find: jest.fn().mockResolvedValue([{ documentId: 'doc-1' }]),
          manager: { query },
        },
      });
      aiService.runAgent.mockRejectedValue(
        upstream(500, ErrorCode.AI_SERVICE_UNAVAILABLE),
      );

      const english = await engine.respond(whatsapp({ name: 'Ally Clinic' }));
      expect(english.body).toBe(
        "Sorry, I couldn't answer that just now. Please try again, or contact Ally Clinic: " +
          '+91 22 6849 3328 / hello@ally.test.',
      );
      const hinglish = await engine.respond(
        turn({
          chatbot: bot({ name: 'Ally Clinic' }),
          text: 'mujhe appointment chahiye kal ke liye',
        }),
      );
      expect(hinglish.body).toContain(
        'Sorry, abhi iska jawab nahi diya ja saka',
      );
      expect(hinglish.body).toContain('+91 22 6849 3328');
      const draftLookup = query.mock.calls.find(([sql]) =>
        String(sql).includes('FROM bot_drafts'),
      );
      expect(draftLookup?.[1]).toEqual(['bot-1']);
    });

    it('sends the crisis reply at once, with no run, when the check decides first (Q3-fast)', async () => {
      aiService.checkWhatsAppCrisis.mockResolvedValueOnce({
        is_crisis: true,
        confidence: 0.9,
        signal: 'end it',
      });
      const decision = await engine.respond(whatsapp());
      expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
      expect(decision.body).toBe(GENERAL_CRISIS_TEXT);
      expect(decision.alert?.type).toBe('Chatbot Crisis Classifier');
      expect(aiService.runAgent).not.toHaveBeenCalled();
    });

    it('still gives the crisis reply when the run fails before a late verdict', async () => {
      engine.levelWaitMs = 0;
      aiService.runAgent.mockRejectedValueOnce(
        upstream(404, ErrorCode.AI_REQUEST_REJECTED),
      );
      aiService.checkWhatsAppCrisis.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({ is_crisis: true, confidence: 0.9, signal: 'end it' }),
              5,
            ),
          ),
      );
      const decision = await engine.respond(whatsapp());
      expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
      expect(decision.body).toBe(GENERAL_CRISIS_TEXT);
      expect(decision.agent?.runtime).toBe(AgentRuntimeUsed.V2_FAILED);
    });

    it('replies in Hinglish, and sends the emergency reply for an emergency (Q3-fast)', async () => {
      aiService.checkWhatsAppCrisis.mockResolvedValue({
        is_crisis: true,
        level: 'at_risk',
        confidence: 0.9,
        signal: 'jeene ka mann nahi',
      });
      const hinglish = await engine.respond(
        turn({ text: 'Mujhe ab jeene ka mann nahi karta, kya karun' }),
      );
      expect(hinglish.body).toMatch(/^Lagta hai yeh urgent ho sakta hai/);
      expect(hinglish.body).toContain('14416');

      aiService.checkWhatsAppCrisis.mockResolvedValue({
        is_crisis: true,
        level: 'emergency',
        self_harm: false,
        confidence: 0.9,
        signal: 'bleeding heavily',
      });
      const emergency = await engine.respond(
        turn({
          chatbot: bot({ name: 'Cloudnine' }),
          settings: { ...settings, helplineNumbers: '99724 99724' },
          text: "I'm 34 weeks pregnant and bleeding heavily",
        }),
      );
      expect(emergency.body).toBe(
        'This sounds like an emergency. Please go to the nearest emergency department now, ' +
          'or call 112 or an ambulance on 108. You can also call Cloudnine on 99724 99724.',
      );
      expect(emergency.alert?.message).toContain('a medical emergency');
    });

    it('runs the crisis check once, alongside, with the same prompts', async () => {
      aiService.runAgent.mockRejectedValueOnce(
        upstream(404, ErrorCode.AI_REQUEST_REJECTED),
      );
      await engine.respond(whatsapp());
      expect(aiService.checkWhatsAppCrisis).toHaveBeenCalledTimes(1);
      expect(aiService.checkWhatsAppCrisis.mock.calls[0][0].prompts).toEqual(
        aiService.runAgent.mock.calls[0][0].prompts,
      );
    });

    it('gives Preview a fresh run id and its own thread', async () => {
      await engine.respond(
        turn({
          chatbot: bot(),
          channel: { type: 'test' },
          conversationId: 'preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11',
        }),
      );
      await engine.respond(
        turn({
          chatbot: bot(),
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
