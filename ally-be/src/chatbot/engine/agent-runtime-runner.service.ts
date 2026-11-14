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
import { AgentRunTokenService } from '../agent-tools/agent-run-token.service';
import {
  listDoneLine,
  parseListToolName,
  todayFor,
} from '../agent-tools/list-tools';
import { handoverOf } from '../handover/handover';
import {
  isPreviewConversation,
  ListToolsService,
} from '../agent-tools/list-tools.service';
import { AgentToolRegistry } from '../agent-tools/tools';
import { ChatbotDocument } from '../entity/chatbot-document.entity';
import { ToolRun, ToolRunStatus } from '../entity/tool-run.entity';
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
  Pick<AgentRunResponse, 'turn_type' | 'handover'>;

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

/**
 * The v2 run failed after a gateway tool had already acted (chunk 3b), so v1 must not answer: the
 * message has been dealt with. `tool` is what acted: `hand_over` gets the hand-over message; a list
 * write (chunk 6) gets `done`, "Done: {record} in {list}."; anything else the bot's fallback wording.
 */
export class AgentActedError extends Error {
  constructor(
    readonly tool: string,
    readonly agent: AgentRunRef,
    readonly done?: string,
  ) {
    super(`The agent run failed after ${tool} acted`);
    this.name = 'AgentActedError';
  }
}

/** "Done: {record} in {list}." from a list write's stored result; undefined if it isn't one. */
function doneLineOf(
  result: Record<string, unknown> | null | undefined,
): string | undefined {
  const list = (result?.list as { name?: unknown } | undefined)?.name;
  const passages = result?.passages as { record_title?: unknown }[] | undefined;
  const title = passages?.[0]?.record_title;
  return typeof list === 'string' && typeof title === 'string'
    ? listDoneLine(title, list)
    : undefined;
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
    @InjectRepository(ToolRun)
    private readonly toolRuns: Repository<ToolRun>,
    private readonly tools: AgentToolRegistry,
    private readonly runTokens: AgentRunTokenService,
    private readonly listTools: ListToolsService,
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
    let withGateway = false;
    try {
      const body = await this.requestFor(turn, request, knowledge, {
        conversationId,
        runId,
      });
      withGateway = Boolean(body.gateway);
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
      // v1 never answers a message whose run has already done something (chunk 3b).
      const acted = withGateway ? await this.actedIn(runId) : null;
      if (acted) {
        this.logger.warn(
          `Agent runtime failed for chatbot ${turn.chatbot.id} (${fallbackReason}) after ` +
            `${acted.tool} acted; not answering with v1`,
        );
        throw new AgentActedError(
          acted.tool,
          {
            runtime: AgentRuntimeUsed.V2_FALLBACK,
            runId,
            conversationId,
            fallbackReason,
          },
          acted.done,
        );
      }
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
    run: { conversationId: string; runId: string; withGateway?: boolean },
  ): Promise<AgentRunRequest> {
    const body = buildAgentRunRequest(request, {
      conversationId: run.conversationId,
      runId: run.runId,
      chatbotId: turn.chatbot.id,
      knowledgeTopics: await this.knowledgeTopics(knowledge),
      declineText: turn.settings.declineText,
    });
    if (run.withGateway === false) return body;
    // The tools this bot has on, from its OWN stored settings (chunk 3b), and its list tools
    // (chunk 6). None: exactly today's request, with no token signed.
    const contactId = turn.contactId ?? null;
    const lists = await this.listToolsFor(turn, run.conversationId, contactId);
    const tools = [
      ...this.tools.servedFor(turn.chatbot.settings),
      ...lists.definitions.map((def) => def.name),
    ];
    if (!tools.length) return body;
    return {
      ...body,
      gateway: {
        url: this.runTokens.gatewayUrl(),
        token: this.runTokens.sign({
          chatbotId: turn.chatbot.id,
          conversationId: run.conversationId,
          runId: run.runId,
          contactId,
          tools,
        }),
        tools,
        ...(lists.definitions.length
          ? {
              definitions: lists.definitions,
              today: todayFor(
                new Date(),
                handoverOf(turn.settings).hours?.timeZone,
              ),
            }
          : {}),
        ...(lists.omitted.length ? { omitted: lists.omitted } : {}),
      },
    };
  }

  /**
   * The list tools this run gets (chunk 6). Preview knows no person but is offered them (a find on
   * a person's list returns nothing; writes are checked and rolled back); a channel whose contact
   * isn't known (WhatsApp with the shared store off) isn't offered the tools of person lists. A
   * failure to read the lists offers none: the run goes on as before.
   */
  private async listToolsFor(
    turn: ChatTurn,
    conversationId: string,
    contactId: string | null,
  ) {
    try {
      return await this.listTools.offeredFor(
        turn.chatbot.id,
        turn.chatbot.settings,
        {
          knowsPerson:
            contactId !== null || isPreviewConversation(conversationId),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not read the bot's lists: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return { definitions: [], omitted: [] };
    }
  }

  /**
   * The gateway tool that acted in this run, if any: `hand_over` first, since it decides the
   * reply; then the last list write, with its "Done:" line. A find only read, so it doesn't count:
   * v1 may still answer. A lookup failure is read as nothing acted, as before 3b.
   */
  private async actedIn(
    runId: string,
  ): Promise<{ tool: string; done?: string } | null> {
    try {
      const rows = (
        await this.toolRuns.find({
          where: { runId, status: ToolRunStatus.OK },
          select: ['tool', 'step', 'result'],
          order: { step: 'ASC' },
        })
      ).filter((row) => parseListToolName(row.tool)?.kind !== 'find');
      if (!rows.length) return null;
      if (rows.some((row) => row.tool === 'hand_over')) {
        return { tool: 'hand_over' };
      }
      const last = rows[rows.length - 1];
      return { tool: last.tool, done: doneLineOf(last.result) };
    } catch (error) {
      this.logger.warn(
        `Could not read the run's tool calls: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
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
