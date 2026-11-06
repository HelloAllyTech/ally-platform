import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { KNOWLEDGE_ANSWER_LIMITS } from '../../ai/constants/knowledge-answer.constants';
import type {
  AgentRetrievalMeta,
  AgentRunResponse,
  KnowledgeAnswerRequest,
  KnowledgeAnswerResponse,
  KnowledgeRetrievalMeta,
} from '../../ai/dto/knowledge.dto';
import { AiService } from '../../ai/service/ai.service';
import { LoggerService } from '../../logger/logger.service';
import { ChatbotDocument } from '../entity/chatbot-document.entity';
import { AgentRuntimeUsed } from '../enum/chatbot.enum';
import {
  agentFailureReason,
  agentRunIdFor,
  MalformedAgentResponseError,
  shadowSide,
} from './agent-runtime';
import type {
  AgentRunRef,
  ChatTurn,
  ShadowRunRequest,
} from './chatbot-engine.types';
import { buildAgentRunRequest, NO_DOCUMENTS } from './knowledge-request';

/**
 * At most this many document titles are sent as the agent's "what I cover" list: ally-ai's limit on
 * `AgentRunRequest.knowledge_topics` (see `AgentRunRequest`).
 */
const MAX_KNOWLEDGE_TOPICS = 50;

/** The test console's channel type. */
const PREVIEW_CHANNEL = 'test';

/**
 * The answer step's wall-clock budget, derived from the SQS visibility window. A v2 bot's fallback
 * to v1 gets only what the failed v2 call left of it.
 */
const ANSWER_BUDGET_MS = KNOWLEDGE_ANSWER_LIMITS.budgetMs;

/** A reply from either engine: v1's response, or v2's without the run fields. */
export type EngineAnswer = KnowledgeAnswerResponse &
  Pick<AgentRunResponse, 'turn_type'>;

/** An answer from either engine, with the run behind it when v2 was involved. */
export interface Answered {
  response: EngineAnswer;
  latencyMs: number;
  agent?: AgentRunRef;
}

/** v2 failed and its v1 fallback failed too; carries the run so the reply still records it. */
export class AgentFallbackFailedError extends Error {
  constructor(
    readonly cause: unknown,
    readonly agent: AgentRunRef,
  ) {
    super(cause instanceof Error ? cause.message : 'v1 fallback failed');
    this.name = 'AgentFallbackFailedError';
  }
}

/** `/agent/run`'s debug-only list of every retrieved chunk; not stored on the message. */
const withoutDebugIds = (
  retrieval: AgentRetrievalMeta,
): KnowledgeRetrievalMeta => {
  const copy = { ...retrieval };
  delete copy.hit_chunk_ids;
  return copy;
};

/**
 * The Agents v2 engine, as the chatbot engine uses it: a v2 bot's answer through ally-ai's
 * `/agent/run` with its fallback to v1, and a shadow bot's comparison run. The chatbot engine keeps
 * the order of steps and turns the answer into a reply; everything about running v2 is here.
 */
@Injectable()
export class AgentRuntimeRunner {
  private readonly logger = LoggerService.getInstance(AgentRuntimeRunner.name);

  constructor(
    @InjectRepository(ChatbotDocument)
    private readonly documentRepository: Repository<ChatbotDocument>,
    private readonly aiService: AiService,
  ) {}

  /**
   * The v2 engine: ally-ai's `/agent/run`, falling back to v1 when it fails before an answer
   * exists (unreachable, timed out, switched off and 404ing, a 5xx, or a reply that is not an
   * answer). Both calls happen before the decision is returned, so the channel still sends once.
   *
   * The fallback spends only what is left of the answer budget: a 25s v2 timeout followed by a
   * full v1 budget would outlive the SQS visibility window and get the message redelivered.
   */
  async answer(
    turn: ChatTurn,
    request: KnowledgeAnswerRequest,
    agentMode: boolean,
    knowledge: Pick<KnowledgeAnswerRequest, 'document_ids'>,
  ): Promise<Answered> {
    const runId = agentRunIdFor(turn.providerMessageId);
    const conversationId = turn.conversationId ?? `preview-${randomUUID()}`;
    const startedAt = Date.now();
    try {
      const response = await this.aiService.runAgent(
        buildAgentRunRequest(request, {
          conversationId,
          runId,
          chatbotId: turn.chatbot.id,
          // Only an agent bot sends these; any other v2 bot's request is the parity request, and
          // ally-ai reads no features as "agent off".
          ...(agentMode
            ? {
                // Every bot answers with the agent now (chunk 3d), whatever it stored.
                features: { ...turn.chatbot.features, agent: true },
                knowledgeTopics: await this.knowledgeTopics(knowledge),
                declineText: turn.settings.declineText,
              }
            : {}),
        }),
      );
      if (!response?.intent) throw new MalformedAgentResponseError();
      const { trace, run_id, ...answer } = response;
      return {
        response: { ...answer, retrieval: withoutDebugIds(answer.retrieval) },
        latencyMs: Date.now() - startedAt,
        agent: {
          runtime: AgentRuntimeUsed.V2,
          runId: run_id || runId,
          conversationId,
          trace: trace ?? [],
        },
      };
    } catch (error) {
      const fallbackReason = agentFailureReason(error);
      this.logger.warn(
        `Agent runtime failed for chatbot ${turn.chatbot.id} (${fallbackReason}); ` +
          `answering with v1`,
      );
      const agent: AgentRunRef = {
        runtime: AgentRuntimeUsed.V2_FALLBACK,
        runId,
        conversationId,
        fallbackReason,
      };
      const fallbackStartedAt = Date.now();
      try {
        const response = await this.aiService.answerKnowledgeQuestionWithin(
          request,
          ANSWER_BUDGET_MS - (Date.now() - startedAt),
        );
        return {
          response,
          latencyMs: Date.now() - fallbackStartedAt,
          agent,
        };
      } catch (v1Error) {
        throw new AgentFallbackFailedError(v1Error, agent);
      }
    }
  }

  /**
   * The comparison run for a shadow bot's message, for the channel to start after it has replied.
   * WhatsApp only: Preview never shadows, and without a provider message id there is no stable
   * run id to record.
   */
  shadowFor(
    turn: ChatTurn,
    request: KnowledgeAnswerRequest,
    answer: KnowledgeAnswerResponse,
    latencyMs: number,
  ): ShadowRunRequest | undefined {
    if (
      turn.channel.type === PREVIEW_CHANNEL ||
      !turn.providerMessageId ||
      !turn.conversationId
    ) {
      return undefined;
    }
    return {
      // Its own thread, so the comparison runs' checkpoints never mix into the conversation's
      // real v2 thread once the bot is switched over.
      request: buildAgentRunRequest(request, {
        conversationId: `shadow-${turn.conversationId}`,
        runId: agentRunIdFor(turn.providerMessageId),
        chatbotId: turn.chatbot.id,
        logRetrieval: false,
      }),
      v1: shadowSide(answer, latencyMs),
    };
  }

  /**
   * The titles of the documents an agent bot answers from: its "what I cover" list. A bot that
   * answers from its organisation's library sends none for now (`knowledge_topics: []`).
   */
  private async knowledgeTopics(
    knowledge: Pick<KnowledgeAnswerRequest, 'document_ids'>,
  ): Promise<string[]> {
    const ids = (knowledge.document_ids ?? []).filter(
      (id) => id !== NO_DOCUMENTS,
    );
    if (!ids.length) return [];
    try {
      const rows = await this.documentRepository.manager.query<
        { title: string }[]
      >(
        `SELECT title FROM kb_documents
          WHERE id = ANY($1::uuid[]) AND archived_at IS NULL
          ORDER BY title
          LIMIT ${MAX_KNOWLEDGE_TOPICS}`,
        [ids],
      );
      return rows.map((row) => row.title).filter((title) => title?.trim());
    } catch (error) {
      // The agent can still answer without the list; it just describes itself less specifically.
      this.logger.warn(
        `Could not load document titles for the agent: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return [];
    }
  }
}
