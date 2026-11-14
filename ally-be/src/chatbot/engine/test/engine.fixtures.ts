import type {
  KnowledgeAnswerResponse,
  KnowledgeRetrievalMeta,
} from '../../../ai/dto/knowledge.dto';
import { Chatbot } from '../../entity/chatbot.entity';
import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotStatus,
} from '../../enum/chatbot.enum';
import { AgentRuntimeRunner } from '../agent-runtime-runner.service';
import { ChatbotEngineService } from '../chatbot-engine.service';

/** The engine specs' shared pieces: a bot, ally-ai's answers and mock, and the engine itself. */

/** A live bot that anyone can chat with, answering from its selected documents. */
export const chatbotFixture = (over: Partial<Chatbot> = {}): Chatbot =>
  ({
    id: 'bot-1',
    name: 'Bot',
    status: ChatbotStatus.LIVE,
    accessMode: ChatbotAccessMode.ANYONE,
    answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
    knowledgeSource: ChatbotKnowledgeSource.SELECTED,
    persona: {},
    model: null,
    settings: {},
    ...over,
  }) as Chatbot;

/** A retrieval block, as both engines return it. */
export const retrievalFixture = (
  over: Partial<KnowledgeRetrievalMeta> = {},
): KnowledgeRetrievalMeta => ({
  top_k: 8,
  min_similarity: 0.3,
  decline_similarity: 0.45,
  hit_count: 3,
  top_similarity: 0.71,
  passages_used: 1,
  query_language: 'en',
  translated_query: null,
  unsupported: false,
  ...over,
});

/** A grounded answer from `/knowledge-agent/answer`. */
export const ANSWER = {
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
      page_from: 1,
      page_to: 1,
      section_path: '',
      source_url: '',
      similarity: 0.71,
    },
  ],
  decline_reason: 'none',
  retrieval: retrievalFixture(),
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  prompt_version: 'v1',
} satisfies KnowledgeAnswerResponse;

export interface EngineAiService {
  answerKnowledgeQuestion: jest.Mock;
  answerKnowledgeQuestionWithin: jest.Mock;
  checkWhatsAppCrisis: jest.Mock;
  runAgent: jest.Mock;
}

/** ally-ai: v1 answers `v1Answer`, `/agent/run` answers `agentAnswer`, and nothing is a crisis. */
export const engineAiService = (
  v1Answer: unknown,
  agentAnswer: unknown,
): EngineAiService => ({
  answerKnowledgeQuestion: jest.fn().mockResolvedValue(v1Answer),
  answerKnowledgeQuestionWithin: jest.fn().mockResolvedValue(v1Answer),
  runAgent: jest.fn().mockResolvedValue(agentAnswer),
  checkWhatsAppCrisis: jest
    .fn()
    .mockResolvedValue({ is_crisis: false, confidence: 0, signal: '' }),
});

/** The engine with its v2 runner, everyone it reads mocked. Anyone may chat with the bot. */
export const makeEngine = ({
  aiService,
  promptShared,
  replyService = { match: jest.fn().mockResolvedValue(null) },
  documents = { find: jest.fn().mockResolvedValue([{ documentId: 'doc-1' }]) },
  conversations,
}: {
  aiService: EngineAiService;
  promptShared: { getPromptsByOptions: jest.Mock };
  replyService?: unknown;
  /** The ChatbotDocument repository. */
  documents?: unknown;
  /** The shared store, for who holds a chat (chunk 11a); without it no chat is held. */
  conversations?: { holderOf: jest.Mock };
}): ChatbotEngineService =>
  new ChatbotEngineService(
    documents as never,
    replyService as never,
    { renderPlaceholders: (text: string) => text } as never,
    { canChat: jest.fn().mockResolvedValue(true) } as never,
    aiService as never,
    promptShared as never,
    new AgentRuntimeRunner(documents as never, aiService as never),
    conversations as never,
  );
