import { Injectable, Optional } from '@nestjs/common';
import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import { LlmUsageService } from '../../analytics/service/llm-usage.service';
import { ContextRetrievalService } from '../../context-library/service/context-retrieval.service';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import { LoggerService } from '../../logger/logger.service';
import { AgentLlmProviderFactory } from '../../llm-agent/service/agent-llm.factory';
import {
  AgentContentBlock,
  AgentMessage,
  AgentToolDefinition,
  AgentTurnResult,
} from '../../llm-agent/type/agent-llm.type';
import {
  DEBRIEF_REPLY_BUDGET_USD,
  DEBRIEF_REPLY_MAX_TURNS,
  DebriefReplyConfig,
} from '../constants/debrief-release.constants';
import { guidancePassage, guidanceSearch } from '../util/debrief-guidance.util';
import { DebriefContextRepository } from './debrief-context.repository';

/** Each tool must answer within this, or the model is told it is unavailable. */
const TOOL_MS = 1500;
/** A guidance topic is a few words naming a skill or situation, never a message. */
const TOPIC_MAX_WORDS = 10;
const TOPIC_MAX_CHARS = 80;

/**
 * Ask Ally's tools (v9 FR-43: the reply chat shares the debrief's
 * capabilities — knowledge base, learner history, session data). The session
 * transcript, the debrief and the organisation's wording are already in the
 * prompt; these are what a question may need beyond them.
 */
export const DEBRIEF_REPLY_TOOLS: AgentToolDefinition[] = [
  {
    name: 'search_guidance',
    description:
      'Look up practice guidance the learner’s organisation uses, for a ' +
      'counselling skill or situation the learner is asking about. Use it when ' +
      'the answer should rest on guidance rather than on the session alone.',
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description:
            'The skill or situation in a few words, e.g. "responding to a ' +
            'suicide disclosure" or "open questions". Never the learner’s own ' +
            'words, names or personal details.',
        },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_learner_history',
    description:
      'The learner’s earlier "Work on this" points from past debriefs, newest ' +
      'first. Use it when they ask how they are doing over time or whether ' +
      'something keeps coming up.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_live_detections',
    description:
      'What the live detector recorded during this roleplay for each ' +
      'behaviour the scenario watches for. It can be wrong; use it only as a ' +
      'second opinion next to the transcript.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

/** One tool call, as the run keeps it for the Console. Never the learner's message. */
export interface ReplyToolCall {
  name: string;
  /** search_guidance only: the topic the model searched. */
  topic?: string;
  ok: boolean;
  ms: number;
  /** What came back, in one line. */
  found: string;
}

export interface ReplyTrace {
  at: string;
  model: string;
  turns: number;
  costUsd: number;
  tools: ReplyToolCall[];
  /** Why the loop stopped calling tools, when it was not the model's choice. */
  stoppedBy?: 'max_turns' | 'budget';
}

export interface ReplyAgentInput {
  model: DebriefReplyConfig;
  system: string;
  history: AgentMessage[];
  message: string;
  sessionId: string;
  tenantId: string | null;
  userId: number;
  chatId: string;
  runId: string;
  /** Called with each piece of reply text as it arrives. */
  onText: (text: string) => void;
}

export interface ReplyAgentResult {
  text: string;
  /** Everything a tool returned, so the quote check can accept quotes from it. */
  toolTexts: string[];
  trace: ReplyTrace;
}

/**
 * The Ask Ally loop: up to `maxTurns` model passes, each able to call the
 * tools above, within the reply's dollar budget. The last pass — or the
 * first one the budget can't stretch past — forbids tools, so a reply always
 * ends in words for the learner. Thinking is off: it would delay the first
 * words and eat the reply's tokens.
 */
@Injectable()
export class DebriefReplyAgentService {
  private readonly logger = LoggerService.getInstance(
    DebriefReplyAgentService.name,
  );

  constructor(
    private readonly providers: AgentLlmProviderFactory,
    private readonly usage: LlmUsageService,
    private readonly context: DebriefContextRepository,
    @Optional() private readonly guidance?: ContextRetrievalService,
  ) {}

  async reply(input: ReplyAgentInput): Promise<ReplyAgentResult> {
    const { model } = input;
    const provider = this.providers.create(model.provider, model.model);
    const budget = model.budgetUsd ?? DEBRIEF_REPLY_BUDGET_USD;
    const maxTurns = Math.max(1, model.maxTurns ?? DEBRIEF_REPLY_MAX_TURNS);
    const messages: AgentMessage[] = [
      ...input.history,
      { role: 'user', content: input.message },
    ];
    const trace: ReplyTrace = {
      at: new Date().toISOString(),
      model: model.model,
      turns: 0,
      costUsd: 0,
      tools: [],
    };
    const toolTexts: string[] = [];
    let text = '';
    let lastTurnCost = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      const finalTurn = turn === maxTurns - 1;
      // Another tool round is allowed only if a pass like the last one, and
      // then a closing pass, would still fit the budget.
      const overBudget =
        turn > 0 && trace.costUsd + 2 * lastTurnCost * 1.2 > budget;
      const closing = finalTurn || overBudget;
      if (closing && turn > 0) {
        trace.stoppedBy = overBudget && !finalTurn ? 'budget' : 'max_turns';
      }
      let result: AgentTurnResult | null = null;
      for await (const event of provider.stream({
        model: model.model,
        system: input.system,
        messages,
        maxTokens: model.maxTokens,
        tools: DEBRIEF_REPLY_TOOLS,
        ...(closing ? { toolChoice: 'none' as const } : {}),
        thinkingBudget: 0,
      })) {
        if (event.type === 'text_delta') {
          text += event.text;
          input.onText(event.text);
        } else {
          result = event.message;
        }
      }
      trace.turns++;
      if (!result) break;
      lastTurnCost = this.record(input, result);
      trace.costUsd = Number((trace.costUsd + lastTurnCost).toFixed(6));

      const calls = result.content.filter(
        (b): b is Extract<AgentContentBlock, { type: 'tool_use' }> =>
          b.type === 'tool_use',
      );
      if (closing || result.stopReason !== 'tool_use' || calls.length === 0) {
        break;
      }
      const results: AgentContentBlock[] = [];
      for (const call of calls) {
        const { content, record } = await this.runTool(call, input);
        trace.tools.push(record);
        if (record.ok) toolTexts.push(content);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content,
          ...(record.ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: 'assistant', content: result.content });
      messages.push({ role: 'user', content: results });
    }
    return { text, toolTexts, trace };
  }

  /** Records a pass's tokens against the reply task; returns its cost. */
  private record(input: ReplyAgentInput, result: AgentTurnResult): number {
    const { costUsd } = computeCostUsd(
      input.model.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
    );
    void this.usage.record({
      provider: input.model.provider,
      model: input.model.model,
      task: LlmTask.DEBRIEF_REPLY,
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      cachedTokens: result.usage.cachedTokens,
      tenantId: input.tenantId ?? undefined,
      scenarioSessionId: input.sessionId,
      metadata: {
        chatId: input.chatId,
        runId: input.runId,
        model: input.model.model,
      },
    });
    return costUsd;
  }

  /** Runs one tool within TOOL_MS; a slow or failed tool tells the model so. */
  private async runTool(
    call: { name: string; input: Record<string, any> },
    input: ReplyAgentInput,
  ): Promise<{ content: string; record: ReplyToolCall }> {
    const t0 = Date.now();
    const done = (
      ok: boolean,
      content: string,
      found: string,
      topic?: string,
    ) => ({
      content,
      record: {
        name: call.name,
        ...(topic ? { topic } : {}),
        ok,
        ms: Date.now() - t0,
        found,
      },
    });
    try {
      const work = this.tool(call, input);
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timed out')), TOOL_MS).unref?.();
      });
      const out = await Promise.race([work, timeout]);
      return done(true, out.content, out.found, out.topic);
    } catch (e) {
      this.logger.warn(
        `[debrief] Ask Ally tool ${call.name} failed for run ${input.runId}: ${(e as Error).message}`,
      );
      return done(
        false,
        'This is unavailable right now. Answer from the debrief and the session.',
        `unavailable (${(e as Error).message.slice(0, 60)})`,
      );
    }
  }

  private async tool(
    call: { name: string; input: Record<string, any> },
    input: ReplyAgentInput,
  ): Promise<{ content: string; found: string; topic?: string }> {
    switch (call.name) {
      case 'search_guidance': {
        const topic = cleanTopic(call.input?.topic);
        if (!topic) {
          return {
            content: 'Name a skill or situation to look up.',
            found: 'no topic',
          };
        }
        if (!this.guidance) {
          return { content: 'No guidance is available.', found: 'none', topic };
        }
        const { results, noConfidentMatch } = await this.guidance.search(
          guidanceSearch(topic, input.tenantId, 3, input.sessionId),
        );
        const passages = noConfidentMatch
          ? []
          : results.map(({ chunk }) => guidancePassage(chunk));
        return passages.length
          ? {
              content: passages
                .map((p) => `${p.title}: ${p.text}`)
                .join('\n\n'),
              found:
                `${passages.length} passage(s): ${passages.map((p) => p.title).join('; ')}`.slice(
                  0,
                  200,
                ),
              topic,
            }
          : {
              content:
                'Nothing in the guidance matches confidently. Answer without it.',
              found: 'no confident match',
              topic,
            };
      }
      case 'get_learner_history': {
        const past = await this.context.pastWorkOnThis(
          input.userId,
          input.tenantId,
          input.sessionId,
          10,
        );
        return past.length
          ? {
              content: past
                .map((p) => `${p.date} · ${p.skill}: ${p.point}`)
                .join('\n'),
              found: `${past.length} earlier point(s)`,
            }
          : {
              content: 'This learner has no earlier debriefs.',
              found: 'none',
            };
      }
      case 'get_live_detections': {
        const session = await this.context.loadSession(input.sessionId);
        const detections = await this.context.liveDetections(
          input.sessionId,
          session?.scenarioId ?? null,
        );
        return detections.length
          ? {
              content: detections
                .map(
                  (d) =>
                    `${d.behaviour}: ${d.detected ? `detected (${d.times}×)` : 'not detected'}`,
                )
                .join('\n'),
              found: `${detections.filter((d) => d.detected).length} of ${detections.length} detected`,
            }
          : {
              content: 'The scenario has no live detector record.',
              found: 'none',
            };
      }
      default:
        throw new Error(`unknown tool ${call.name}`);
    }
  }
}

/** A short topic, or null: more than a few words reads as a message, not a topic. */
export function cleanTopic(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const words = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, TOPIC_MAX_WORDS).join(' ').slice(0, TOPIC_MAX_CHARS);
}
