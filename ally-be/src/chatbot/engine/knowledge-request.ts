import type {
  AgentRunRequest,
  KnowledgeAnswerRequest,
} from '../../ai/dto/knowledge.dto';
import { ChatbotAnswerMode } from '../enum/chatbot.enum';
import type { ChatTurn } from './chatbot-engine.types';

/**
 * The ONE place the knowledge request is built. v1 sends it to `/knowledge-agent/answer` as is;
 * v2 and shadow send it to `/agent/run` with the run's identity added (`buildAgentRunRequest`). A
 * field added here reaches both engines, so they cannot drift apart.
 */
export function buildKnowledgeRequest(
  turn: ChatTurn,
  prompts: Record<string, unknown>,
  knowledge: Pick<KnowledgeAnswerRequest, 'audience' | 'document_ids'>,
): KnowledgeAnswerRequest {
  const { chatbot, settings } = turn;
  return {
    question: turn.text,
    history: turn.history,
    prompts,
    ...knowledge,
    persona: personaRequest(turn),
    answer_mode: chatbot.answerMode ?? ChatbotAnswerMode.DOCUMENTS_ONLY,
    channel: turn.channel.type,
    top_k: settings.retrieval.topK,
    min_similarity: settings.retrieval.minSimilarity,
    decline_similarity: settings.retrieval.declineSimilarity,
    max_passages: settings.retrieval.maxPassages,
    max_context_tokens: settings.retrieval.maxContextTokens,
    similarity_band: settings.retrieval.similarityBand,
    max_answer_chars: settings.maxAnswerChars,
    translate_query: settings.retrieval.translateQuery,
  };
}

/** The v1 body plus the four fields that identify the run. */
export function buildAgentRunRequest(
  request: KnowledgeAnswerRequest,
  run: {
    conversationId: string;
    runId: string;
    chatbotId: string;
    logRetrieval?: boolean;
  },
): AgentRunRequest {
  return {
    ...request,
    conversation_id: run.conversationId,
    run_id: run.runId,
    chatbot_id: run.chatbotId,
    runtime_version: 'v2',
    ...(run.logRetrieval === false ? { log_retrieval: false } : {}),
  };
}

function personaRequest(turn: ChatTurn): KnowledgeAnswerRequest['persona'] {
  const persona = turn.chatbot.persona ?? {};
  const out = {
    display_name: persona.displayName?.trim() || undefined,
    system_prompt: persona.systemPrompt?.trim() || undefined,
    tone: persona.tone?.trim() || undefined,
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}
