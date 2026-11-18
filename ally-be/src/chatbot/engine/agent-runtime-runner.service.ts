import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
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
  listStatusLine,
  parseListToolName,
  todayFor,
} from '../agent-tools/list-tools';
import { handoverOf } from '../handover/handover';
import { assistantZone } from '../agent-tools/list-tools';
import {
  isPreviewConversation,
  ListToolsService,
} from '../agent-tools/list-tools.service';
import { AgentToolRegistry } from '../agent-tools/tools';
import { ChatbotDocument } from '../entity/chatbot-document.entity';
import { ToolRun, ToolRunStatus } from '../entity/tool-run.entity';
import { MemoryService } from '../memory/memory.service';
import { AgentRuntimeUsed } from '../enum/chatbot.enum';
import {
  agentFailureReason,
  agentRunIdFor,
  MalformedAgentResponseError,
} from './agent-runtime';
import type { AgentRunRef, ChatTurn, LiveReply } from './chatbot-engine.types';
import { businessFacts } from './business-facts';
import { buildAgentRunRequest, NO_DOCUMENTS } from './knowledge-request';
import { contactFromSources } from './run-failed-reply';

/**
 * At most this many document titles are sent as the agent's "what I cover" list: ally-ai's limit on
 * `AgentRunRequest.knowledge_topics` (see `AgentRunRequest`).
 */
const MAX_KNOWLEDGE_TOPICS = 50;

/** The agent's reply, without the run fields (v1's response shape, which v2 extends). */
export type EngineAnswer = KnowledgeAnswerResponse &
  Pick<AgentRunResponse, 'turn_type' | 'handover'>;

/** The agent's answer, with the run behind it. */
export interface Answered {
  response: EngineAnswer;
  latencyMs: number;
  agent?: AgentRunRef;
}

/**
 * The run failed or ran out of time before an answer existed (Q3-fast Part 0). The person gets the
 * fixed run-failed reply, never v1; this carries the run so the reply still records it.
 */
export class AgentRunFailedError extends Error {
  constructor(
    readonly cause: unknown,
    readonly agent: AgentRunRef,
  ) {
    super(cause instanceof Error ? cause.message : 'the agent run failed');
    this.name = 'AgentRunFailedError';
  }
}

/**
 * The run failed after a gateway tool had already acted (chunk 3b): the message has been dealt
 * with, so it gets what was done rather than the run-failed reply. `tool` is what acted: `hand_over` gets the hand-over message; a list
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

/**
 * "Done: {record} in {list}." from a list write's stored result; undefined if it isn't one. A
 * change that set a status says it ("Cancelled: … in Appointments.", chunk 8a), so a reply cut
 * short after a reschedule doesn't read as if the old time were still booked.
 */
export function doneLineOf(
  result: Record<string, unknown> | null | undefined,
  input?: Record<string, unknown> | null,
): string | undefined {
  const list = (result?.list as { name?: unknown } | undefined)?.name;
  const passages = result?.passages as { record_title?: unknown }[] | undefined;
  const title = passages?.[0]?.record_title;
  if (typeof list !== 'string' || typeof title !== 'string') return undefined;
  const status = input?.status;
  return typeof status === 'string' && status.trim()
    ? listStatusLine(status, title, list)
    : listDoneLine(title, list);
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
 * The Agents v2 engine, as the chatbot engine uses it: the answer through ally-ai's `/agent/run`.
 * Every channel answers this one way (Q3-fast Part 0: no runtime switch, no v1 fallback). The
 * chatbot engine keeps the order of steps and turns the answer into a reply; everything about
 * running v2 is here.
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
    // Memory, light (chunk 8a). Optional: without it a run is exactly as before.
    @Optional() private readonly memory?: MemoryService,
  ) {}

  /**
   * The v2 engine: ally-ai's `/agent/run`. When it fails before an answer exists (unreachable,
   * timed out, switched off and 404ing, a 5xx, or a reply that is not an answer) it throws
   * `AgentRunFailedError`, and the engine sends the fixed run-failed reply (Q3-fast Part 0).
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
    /**
     * Q3-fast Part 1: `mood` is the crisis check's "upset", told to the run; `signal` cancels the
     * run once a crisis or emergency reply has gone out instead.
     */
    options: { mood?: 'upset'; signal?: AbortSignal } = {},
  ): Promise<Answered> {
    const runId = agentRunIdFor(turn.providerMessageId);
    const conversationId = turn.conversationId ?? `preview-${randomUUID()}`;
    const startedAt = Date.now();
    let withGateway = false;
    try {
      const shown: { refs: Record<string, string> } = { refs: {} };
      const body = await this.requestFor(
        turn,
        request,
        knowledge,
        { conversationId, runId },
        shown,
      );
      withGateway = Boolean(body.gateway);
      if (options.mood) {
        body.mood = options.mood;
        const helplines = turn.settings.helplineNumbers?.trim();
        if (helplines) body.support_helplines = helplines.slice(0, 300);
      }
      const streamed = Boolean(live && turn.channel.capabilities?.streaming);
      const signals = [live?.signal, options.signal].filter(
        (signal): signal is AbortSignal => Boolean(signal),
      );
      const response = streamed
        ? await this.aiService.runAgentStreaming(
            // Live steps (chunk 6b): only a streamed run, the bot page's or Try it's, asks for
            // them; WhatsApp can't stream, so its request is unchanged.
            { ...body, activity: true },
            (event) => live!.onEvent(event),
            signals.length ? AbortSignal.any(signals) : undefined,
          )
        : await this.aiService.runAgent(body, options.signal);
      if (!response?.intent) throw new MalformedAgentResponseError();
      const { trace, run_id, memory_writes, activity, ...answer } = response;
      return {
        response: { ...answer, retrieval: withoutDebugIds(answer.retrieval) },
        latencyMs: Date.now() - startedAt,
        agent: {
          runtime: AgentRuntimeUsed.V2,
          runId: run_id || runId,
          conversationId,
          trace: trace ?? [],
          // Applied by the channel after the reply, never here (chunk 8a).
          ...(memory_writes?.length
            ? { memory: { writes: memory_writes, refs: shown.refs } }
            : {}),
          ...(activity?.length ? { activity } : {}),
        },
      };
    } catch (error) {
      // The person left Preview, or a crisis reply went out instead: nobody is waiting.
      if (live?.signal?.aborted || options.signal?.aborted) throw error;
      const fallbackReason = agentFailureReason(error);
      const agent: AgentRunRef = {
        runtime: AgentRuntimeUsed.V2_FAILED,
        runId,
        conversationId,
        fallbackReason,
      };
      // A run that has already done something says what it did (chunk 3b).
      const acted = withGateway ? await this.actedIn(runId) : null;
      if (acted) {
        this.logger.warn(
          `Agent runtime failed for chatbot ${turn.chatbot.id} (${fallbackReason}) after ` +
            `${acted.tool} acted`,
        );
        throw new AgentActedError(acted.tool, agent, acted.done);
      }
      this.logger.warn(
        `Agent runtime failed for chatbot ${turn.chatbot.id} (${fallbackReason}); ` +
          `sending the run-failed reply`,
      );
      throw new AgentRunFailedError(error, agent);
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
    shown?: { refs: Record<string, string> },
  ): Promise<AgentRunRequest> {
    // What it knows about the person (chunk 8a): their lines with memory on, this chat's summary
    // and their name, each only when there is one. Nothing: exactly today's request.
    const [knowledgeTopics, memory, facts] = await Promise.all([
      this.knowledgeTopics(knowledge),
      this.memory
        ? this.memory.forRun(
            turn.chatbot,
            turn.contactId,
            run.conversationId,
            assistantZone({
              timeZone: turn.chatbot.settings?.timeZone,
              handover: handoverOf(turn.settings),
            }),
          )
        : Promise.resolve({ fields: {}, refs: {} }),
      // How to reach the business, from its sources (Q3-fast Part 2): a decline gives it
      // when the owner's decline wording has no contact of its own.
      businessFacts(this.documentRepository.manager, turn.chatbot.id),
    ]);
    const contact = contactFromSources(facts, turn.settings.helplineNumbers);
    if (shown) shown.refs = memory.refs;
    const body: AgentRunRequest = {
      ...buildAgentRunRequest(request, {
        conversationId: run.conversationId,
        runId: run.runId,
        chatbotId: turn.chatbot.id,
        knowledgeTopics,
        declineText: turn.settings.declineText,
      }),
      ...memory.fields,
      ...(contact ? { business_contact: contact.slice(0, 200) } : {}),
    };
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
                assistantZone({
                  timeZone: turn.chatbot.settings?.timeZone,
                  handover: handoverOf(turn.settings),
                }),
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
   * the run-failed reply still goes out. A lookup failure is read as nothing acted, as before 3b.
   */
  private async actedIn(
    runId: string,
  ): Promise<{ tool: string; done?: string } | null> {
    try {
      const rows = (
        await this.toolRuns.find({
          where: { runId, status: ToolRunStatus.OK },
          select: ['tool', 'step', 'input', 'result'],
          order: { step: 'ASC' },
        })
      ).filter((row) => parseListToolName(row.tool)?.kind !== 'find');
      if (!rows.length) return null;
      if (rows.some((row) => row.tool === 'hand_over')) {
        return { tool: 'hand_over' };
      }
      // Every write the run made, in order (chunk 8a): a reschedule is a cancel and a booking.
      const lines = rows
        .map((row) =>
          doneLineOf(
            row.result as Record<string, unknown> | null,
            (row.input as Record<string, unknown> | null) ?? null,
          ),
        )
        .filter((line): line is string => Boolean(line));
      const last = rows[rows.length - 1];
      return {
        tool: last.tool,
        done: lines.length ? lines.join(' ') : undefined,
      };
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
