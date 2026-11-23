import { usageContext } from 'src/billing/context/usage-context';
import { crisisHelplines } from './crisis-helplines';
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
import { parseListToolName, todayFor } from '../agent-tools/list-tools';
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
import { endedBy, stageLine } from './agent-stage-log';
import { AGENT_RUN_LIMITS } from '../../ai/constants/knowledge-answer.constants';
import { ListConsentService } from '../agent-tools/list-consent.service';
import {
  questionIn,
  questionShown,
  type OfferQuestions,
} from '../agent-tools/list-consent';
import { businessFacts } from './business-facts';
import { AGENT_KEY_FACTS_ON, keyFactsFor } from './key-facts';
import { buildAgentRunRequest, NO_DOCUMENTS } from './knowledge-request';
import { contactFromSources } from './run-failed-reply';

/**
 * At most this many document titles are sent as the agent's "what I cover" list: ally-ai's limit on
 * `AgentRunRequest.knowledge_topics` (see `AgentRunRequest`).
 */
const MAX_KNOWLEDGE_TOPICS = 50;

/** How long a reply waits for a list write already on its way when the run is cut off (H1). */
const IN_FLIGHT_WAIT_MS = 2_000;

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
 * What a list write saved, from its stored result (chunk H1 Part B): every detail the agent may
 * read, as the record now is, and for a change what it was before, so a reply cut short never
 * claims a bare "Done" and never hides a move or a cancel. Undefined if it isn't a list write.
 *
 *   Saved in Appointments: Slot: Wed 25 Nov 2026, 15:00; Client: Priya Test; Service: Eye checkup.
 *   Changed in Appointments: Slot: Sat 21 Nov 2026, 11:00; Service: Eye checkup → now Slot: Sat 21
 *   Nov 2026, 13:00; Service: LASIK consultation.
 */
export function doneLineOf(
  result: Record<string, unknown> | null | undefined,
  input?: Record<string, unknown> | null,
): string | undefined {
  const list = (result?.list as { name?: unknown } | undefined)?.name;
  const after = fieldsOf((result?.passages as { text?: unknown }[])?.[0]);
  if (typeof list !== 'string' || !after.length) return undefined;
  const before = fieldsOf(result?.before as { text?: unknown } | undefined);
  const said = (fields: [string, string][]): string =>
    fields.map(([label, value]) => `${label}: ${value}`).join('; ');
  if (!before.length) return `Saved in ${list}: ${said(after)}.`;
  const status = typeof input?.status === 'string' ? input.status : '';
  if (/cancel|withdraw|no.?show|rejected|declined/i.test(status)) {
    return `Cancelled in ${list}: ${said(before)}.`;
  }
  const was = new Map(before);
  const changed = after.filter(([label, value]) => was.get(label) !== value);
  const touched = new Set(changed.map(([label]) => label));
  return `Changed in ${list}: ${said(before.filter(([label]) => touched.has(label)))} → now ${said(changed)}.`;
}

/** A record passage's "Label: value" lines, without its id. */
function fieldsOf(
  passage: { text?: unknown } | null | undefined,
): [string, string][] {
  if (typeof passage?.text !== 'string') return [];
  return (
    passage.text
      .split('\n')
      .map((line) => /^([^:]+):\s*(.+)$/.exec(line))
      .filter((m): m is RegExpExecArray => Boolean(m) && m![1] !== 'id')
      .map((m): [string, string] => [m[1].trim(), m[2].trim()])
      // A contact with no name yet ("A contact") isn't a detail to say back (chunk H1).
      .filter(([, value]) => !/^(?:a contact|visitor\b|unknown)/i.test(value))
  );
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
    // Consent for list writes (chunk H1). Without it no turn carries a yes: every write asks.
    @Optional() private readonly consent?: ListConsentService,
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
    // Preview has no provider id: reuse the run id its usage context already named (CR1), so the
    // run's metered calls and the run itself share one id.
    const runId = turn.providerMessageId
      ? agentRunIdFor(turn.providerMessageId)
      : (usageContext.current()?.runId ?? agentRunIdFor(null));
    const conversationId = turn.conversationId ?? `preview-${randomUUID()}`;
    const startedAt = Date.now();
    let withGateway = false;
    const streamedRun = Boolean(live && turn.channel.capabilities?.streaming);
    // The run's cap (chunk H1): ally-be names it, waits a little longer, and the token dies with it.
    const capS = streamedRun
      ? AGENT_RUN_LIMITS.streamedCapS
      : AGENT_RUN_LIMITS.waitedCapS;
    try {
      const shown: { refs: Record<string, string> } = { refs: {} };
      const body = await this.requestFor(
        turn,
        request,
        knowledge,
        { conversationId, runId, capS },
        shown,
      );
      withGateway = Boolean(body.gateway);
      this.logger.info(
        stageLine(runId, startedAt, 'run_request_built', {
          streamed: streamedRun,
          gateway: withGateway,
          history: body.history?.length ?? 0,
        }),
      );
      let firstToken = false;
      if (options.mood) {
        body.mood = options.mood;
        // Q4 G7: only the numbers the owner confirmed for crisis replies.
        const helplines = crisisHelplines(turn.settings);
        if (helplines) body.support_helplines = helplines.slice(0, 300);
      }
      const streamed = streamedRun;
      const signals = [live?.signal, options.signal].filter(
        (signal): signal is AbortSignal => Boolean(signal),
      );
      const response = streamed
        ? await this.aiService.runAgentStreaming(
            // Live steps (chunk 6b): only a streamed run, the bot page's or Try it's, asks for
            // them; WhatsApp can't stream, so its request is unchanged.
            { ...body, activity: true },
            (event) => {
              if (event.event === 'token' && !firstToken) {
                firstToken = true;
                this.logger.info(
                  stageLine(runId, startedAt, 'first_token_relayed'),
                );
              }
              live!.onEvent(event);
            },
            signals.length ? AbortSignal.any(signals) : undefined,
          )
        : await this.aiService.runAgent(body, options.signal);
      if (!response?.intent) throw new MalformedAgentResponseError();
      const { trace, run_id, memory_writes, activity, ...ran } = response;
      // A write that waits for a yes (chunk H1): the reply carries its exact question, or the
      // person's yes next turn couldn't be matched to it.
      const asked = withGateway ? await this.askedIn(runId) : null;
      const answer =
        asked && !questionShown(ran.answer, asked)
          ? {
              ...ran,
              answer: questionIn(asked, ran.language),
              intent: 'clarify' as const,
              citations: [],
            }
          : ran;
      this.logger.info(
        stageLine(runId, startedAt, 'run_end', {
          reason: 'finished',
          ended_by: 'ally-ai_final',
          intent: answer.intent,
        }),
      );
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
      const callerAborted = Boolean(
        live?.signal?.aborted || options.signal?.aborted,
      );
      this.logger.info(
        stageLine(runId, startedAt, 'run_end', {
          reason: 'failed',
          ended_by: endedBy(error, callerAborted),
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
      // The person left Preview, or a crisis reply went out instead: nobody is waiting, and nothing
      // may be written for this run any more (chunk H1).
      if (callerAborted) {
        if (withGateway) await this.consent?.endRun(runId);
        throw error;
      }
      const fallbackReason = agentFailureReason(error);
      const agent: AgentRunRef = {
        runtime: AgentRuntimeUsed.V2_FAILED,
        runId,
        conversationId,
        fallbackReason,
      };
      // ally-be stops waiting (chunk H1): the gateway refuses the run's later writes, and a write
      // already on its way is waited for, so the reply says what was saved.
      if (withGateway) {
        await this.consent?.endRun(runId);
        await this.settleWrites(runId);
      }
      // A run that has already done something says what it did (chunk 3b), from the saved record.
      const acted = withGateway ? await this.actedIn(runId) : null;
      // One that only got as far as asking (chunk H1): its question, not the run-failed reply.
      const asked = !acted && withGateway ? await this.askedIn(runId) : null;
      if (asked) {
        throw new AgentActedError(
          'confirm',
          agent,
          questionIn(
            asked,
            /[\u0900-\u097F]/.test(turn.text ?? '') ? 'hi' : 'en',
          ),
        );
      }
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
    run: {
      conversationId: string;
      runId: string;
      withGateway?: boolean;
      capS?: number;
    },
    shown?: { refs: Record<string, string> },
  ): Promise<AgentRunRequest> {
    // What it knows about the person (chunk 8a): their lines with memory on, this chat's summary
    // and their name, each only when there is one. Nothing: exactly today's request.
    const [knowledgeTopics, memory, facts, keyFacts] = await Promise.all([
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
      // Q4 G3: the facts it must always know, in every run's passages.
      AGENT_KEY_FACTS_ON()
        ? keyFactsFor(this.documentRepository.manager, turn.chatbot.id)
        : Promise.resolve(null),
    ]);
    const contact = contactFromSources(facts, crisisHelplines(turn.settings));
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
      ...(keyFacts ? { key_facts: keyFacts } : {}),
      run_timeout_s: run.capS ?? AGENT_RUN_LIMITS.streamedCapS,
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
    // The person's yes to the question the assistant asked last turn (chunk H1): the only write
    // this run may make without asking.
    if (lists.definitions.length && this.consent) {
      // What this turn's yes answers, for the gateway (chunk H1).
      await this.consent.rememberTurn(
        run.runId,
        request.question,
        lastAssistant(request.history),
      );
    }
    const consent =
      lists.definitions.length && this.consent
        ? await this.consent.consentFor(
            turn.chatbot.id,
            run.conversationId,
            request.question,
            lastAssistant(request.history),
          )
        : null;
    return {
      ...body,
      gateway: {
        url: this.runTokens.gatewayUrl(),
        token: this.runTokens.sign(
          {
            chatbotId: turn.chatbot.id,
            conversationId: run.conversationId,
            runId: run.runId,
            contactId,
            tools,
            consent,
          },
          run.capS ?? AGENT_RUN_LIMITS.streamedCapS,
        ),
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
   * reply; then the list writes, each said from its saved record (`doneLineOf`). A find only read, so it doesn't count:
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
   * Waits (up to `IN_FLIGHT_WAIT_MS`) for a list write the run had already started when ally-be
   * stopped waiting (chunk H1), so `actedIn` sees it.
   */
  private async settleWrites(runId: string): Promise<void> {
    const until = Date.now() + IN_FLIGHT_WAIT_MS;
    try {
      while (Date.now() < until) {
        const started = await this.toolRuns.find({
          where: { runId, status: ToolRunStatus.STARTED },
          select: ['tool'],
        });
        if (
          !started.some((row) => parseListToolName(row.tool)?.kind !== 'find')
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch {
      // Nothing to wait for that we can read: the reply goes as it would have.
    }
  }

  /**
   * The question a list write is waiting on, when this run asked one and wrote nothing after it
   * (chunk H1): both languages, from the gateway's stored answer.
   */
  private async askedIn(runId: string): Promise<OfferQuestions | null> {
    try {
      const rows = await this.toolRuns.find({
        where: { runId },
        select: ['tool', 'step', 'status', 'errorCode', 'result'],
        order: { step: 'ASC' },
      });
      let asked: OfferQuestions | null = null;
      for (const row of rows) {
        if (row.errorCode === 'needs_confirmation') {
          const q = (row.result as { questions?: OfferQuestions } | null)
            ?.questions;
          if (q?.en) asked = q;
        } else if (
          row.status === ToolRunStatus.OK &&
          parseListToolName(row.tool)?.kind !== 'find'
        ) {
          asked = null;
        }
      }
      return asked;
    } catch (error) {
      this.logger.warn(
        `Could not read the run's questions: ${
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

/** The assistant's last message in the history, which the person's yes answers. */
export function lastAssistant(
  history: { role: string; content: string }[] | undefined,
): string | null {
  for (let i = (history?.length ?? 0) - 1; i >= 0; i--) {
    if (history![i].role === 'assistant') return history![i].content;
  }
  return null;
}
