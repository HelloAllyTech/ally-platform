import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { WhatsAppBotSettings } from '../../../whatsapp/type/whatsapp-settings.type';
import { Chatbot } from '../../entity/chatbot.entity';
import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotStatus,
} from '../../enum/chatbot.enum';
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
    checkWhatsAppCrisis: jest.Mock;
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
});
