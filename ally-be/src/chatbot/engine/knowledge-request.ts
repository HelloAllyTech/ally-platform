import type {
  AgentRunRequest,
  KnowledgeAnswerRequest,
} from '../../ai/dto/knowledge.dto';
import { ChatbotAnswerMode } from '../enum/chatbot.enum';
import type { ChatTurn } from './chatbot-engine.types';

/**
 * Messages of conversation sent with a question, most recent last. Older ones are dropped: a long
 * Preview thread otherwise sends everything, and a follow-up depends on what was just said.
 */
export const MAX_HISTORY_MESSAGES = 10;

/** A document id no document has: the "search nothing" filter. */
export const NO_DOCUMENTS = '00000000-0000-0000-0000-000000000000';

/**
 * The longest decline wording `/agent/run` accepts (ally-ai `AgentRunRequest.decline_text`, a 422
 * past it). The agent takes only its tone and where-to-go-next, so a longer wording — valid for v1,
 * which sends it as the reply — is cut rather than failing every message over to v1.
 */
export const MAX_DECLINE_TEXT_CHARS = 500;

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
    history: (turn.history ?? []).slice(-MAX_HISTORY_MESSAGES),
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

/**
 * The v1 body plus the four fields that identify the run, and what only v2 reads: the bot's
 * feature flags and, for the conversational agent, its topics and decline wording.
 */
export function buildAgentRunRequest(
  request: KnowledgeAnswerRequest,
  run: {
    conversationId: string;
    runId: string;
    chatbotId: string;
    logRetrieval?: boolean;
    features?: Record<string, boolean>;
    knowledgeTopics?: string[];
    declineText?: string;
  },
): AgentRunRequest {
  return {
    ...request,
    conversation_id: run.conversationId,
    run_id: run.runId,
    chatbot_id: run.chatbotId,
    runtime_version: 'v2',
    ...(run.logRetrieval === false ? { log_retrieval: false } : {}),
    ...(run.features ? { features: run.features } : {}),
    ...(run.knowledgeTopics ? { knowledge_topics: run.knowledgeTopics } : {}),
    ...(run.declineText
      ? { decline_text: run.declineText.slice(0, MAX_DECLINE_TEXT_CHARS) }
      : {}),
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
