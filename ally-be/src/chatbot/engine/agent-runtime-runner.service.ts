import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { KNOWLEDGE_ANSWER_LIMITS } from '../../ai/constants/knowledge-answer.constants';
import type {
  AgentRetrievalMeta,
  AgentRunResponse,
  AgentRunRequest,
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
} from './agent-runtime';
import type { AgentRunRef, ChatTurn, LiveReply } from './chatbot-engine.types';
import { buildAgentRunRequest, NO_DOCUMENTS } from './knowledge-request';

/**
 * At most this many document titles are sent as the agent's "what I cover" list: ally-ai's limit on
 * `AgentRunRequest.knowledge_topics` (see `AgentRunRequest`).
 */
const MAX_KNOWLEDGE_TOPICS = 50;

/**
 * The answer step's wall-clock budget, derived from the SQS visibility window. The fallback to v1
 * gets only what the failed v2 call left of it.
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
 * The Agents v2 engine, as the chatbot engine uses it: the answer through ally-ai's `/agent/run`,
 * with its fallback to v1. The chatbot engine keeps the order of steps and turns the answer into a
 * reply; everything about running v2 is here.
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
   *
   * With `live`, on a channel that can stream, the same run goes through `/agent/run/stream`: its
   * events go to `live` as they happen, and its `final` is handled exactly like `/agent/run`'s
   * response — so a streamed reply and a waited-for one can't differ.
   */
  async answer(
    turn: ChatTurn,
    request: KnowledgeAnswerRequest,
    knowledge: Pick<KnowledgeAnswerRequest, 'document_ids'>,
    live?: LiveReply,
  ): Promise<Answered> {
    const runId = agentRunIdFor(turn.providerMessageId);
    const conversationId = turn.conversationId ?? `preview-${randomUUID()}`;
    const startedAt = Date.now();
    try {
      const body = await this.requestFor(turn, request, knowledge, {
        conversationId,
        runId,
      });
      const response =
        live && turn.channel.capabilities?.streaming
          ? await this.aiService.runAgentStreaming(
              body,
              (event) => live.onEvent(event),
              live.signal,
            )
          : await this.aiService.runAgent(body);
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
      // The person left Preview: nobody is waiting for a v1 answer.
      if (live?.signal?.aborted) throw error;
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
   * The body `/agent/run` gets for this turn. One place, so the owner's "How it works"
   * (chunk 20d-2, `describe`) is built from exactly what a run sends.
   */
  async requestFor(
    turn: ChatTurn,
    request: KnowledgeAnswerRequest,
    knowledge: Pick<KnowledgeAnswerRequest, 'document_ids'>,
    run: { conversationId: string; runId: string },
  ): Promise<AgentRunRequest> {
    return buildAgentRunRequest(request, {
      conversationId: run.conversationId,
      runId: run.runId,
      chatbotId: turn.chatbot.id,
      knowledgeTopics: await this.knowledgeTopics(knowledge),
      declineText: turn.settings.declineText,
    });
  }

  /**
   * The titles of the documents the bot answers from: its "what I cover" list. A bot that
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
