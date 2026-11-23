import { Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent, HumanMessage, toolStrategy } from 'langchain';
import type { z } from 'zod';
import { resolveAnalyticsChatModel } from '../constants/analytics-agent.constants';
import { AUTOMATION_LIMITS } from '../constants/analytics-automation.constants';
import type { AnalyticsAutomationCommitShas } from '../entity/analytics-automation-run.entity';
import type { RepoRef } from './analytics-automation-github.service';

/** Everything an agent needs to know about the run it belongs to. */
export interface AutomationRunContext {
  runId: string;
  platform: RepoRef & { base: string };
  dbt: RepoRef & { base: string };
  shas: AnalyticsAutomationCommitShas;
}

type CreateAgentParams = Parameters<typeof createAgent>[0];

const agentLogger = new Logger('AnalyticsAutomationAgent');

let llm: ChatOpenAI | undefined;

/**
 * Same model and settings as the Analytics Agent, built on first use so that
 * importing this file (and every suite that loads the module) needs no env.
 */
export function automationLlm(): ChatOpenAI {
  llm ??= new ChatOpenAI({
    model: resolveAnalyticsChatModel(),
    apiKey: process.env.OPENAI_API_KEY,
    supportsStrictToolCalling: false,
    useResponsesApi: true,
  });
  return llm;
}

/**
 * Runs one LangChain agent to a validated structured answer. Throws when the
 * agent finishes without one, so a run never records a made-up result.
 */
export async function runStructuredAgent<
  S extends z.ZodObject<z.ZodRawShape>,
>(opts: {
  /** Names the agent in the log lines, e.g. `posthog-events`. */
  label: string;
  systemPrompt: string;
  schema: S;
  input: string;
  tools: CreateAgentParams['tools'];
}): Promise<z.infer<S>> {
  const agent = createAgent({
    model: automationLlm(),
    systemPrompt: opts.systemPrompt,
    responseFormat: toolStrategy(opts.schema),
    tools: opts.tools,
  });
  const startedAt = Date.now();
  const toolCalls: Record<string, number> = {};
  agentLogger.log(`[${opts.label}] started`);
  const result = await agent.invoke(
    { messages: [new HumanMessage(opts.input)] },
    {
      recursionLimit: AUTOMATION_LIMITS.RECURSION_LIMIT,
      // One line per tool call, so a run can be followed as it happens.
      callbacks: [
        {
          handleToolStart: (
            _tool: unknown,
            input: string,
            _runId: string,
            _parentRunId?: string,
            _tags?: string[],
            _metadata?: Record<string, unknown>,
            name?: string,
          ) => {
            const tool = name ?? 'tool';
            toolCalls[tool] = (toolCalls[tool] ?? 0) + 1;
            agentLogger.log(
              `[${opts.label}] ${tool} ${String(input).replace(/\s+/g, ' ').slice(0, 140)}`,
            );
          },
        },
      ],
    },
  );
  const calls = Object.entries(toolCalls)
    .map(([name, n]) => `${name}×${n}`)
    .join(', ');
  agentLogger.log(
    `[${opts.label}] finished in ${Math.round((Date.now() - startedAt) / 1000)}s; tool calls: ${calls || 'none'}`,
  );
  const parsed = opts.schema.safeParse(
    (result as { structuredResponse?: unknown }).structuredResponse,
  );
  if (!parsed.success) {
    throw new Error('The agent finished without a valid structured answer');
  }
  return parsed.data;
}

/** The period an agent is asked about, as plain text. */
export function describePlatformPeriod(ctx: AutomationRunContext): string {
  const { platform, shas } = ctx;
  return [
    `Platform repo: owner "${platform.owner}", repo "${platform.repo}" (default branch "${platform.base}").`,
    `Head commit to review up to: ${shas.platform.head}.`,
    shas.platform.base
      ? `The last weekly run covered up to commit ${shas.platform.base}. Review what came after it.`
      : 'There was no earlier weekly run: review the commits since the date below.',
    `List commits since: ${shas.platform.since}.`,
  ].join('\n');
}

/** Where a pull request's CI is, as the agent that watches it reports it. */
export type AutomationCiState =
  /** Waiting for the checks to finish. */
  | 'running'
  /** A check failed; the agent is working on a fix. */
  | 'fixing'
  /** Every check passed. */
  | 'green'
  /** Still failing: out of attempts, or the failure is not one the agent can fix. */
  | 'failed'
  /** The pull request has no checks at all. */
  | 'none'
  /** The checks did not finish in time. */
  | 'timeout'
  /** The pull request was merged or closed while CI was being watched. */
  | 'stopped'
  /** GitHub could not be asked (including a missing permission to read checks). */
  | 'unreadable';

export interface AutomationCiProgress {
  state: AutomationCiState;
  /** Fix attempts made so far. */
  attempts: number;
  /** One line for the person reading the run. */
  message: string;
  /** Names of the checks that failed, when any. */
  failedChecks: string[];
}

/** Hands a pull request the agent opened to whoever persists it. */
export interface AutomationPrSink {
  savePullRequest(pr: {
    repo: string;
    number: number;
    url: string;
  }): Promise<void>;
  saveReview(review: {
    verdict: 'approve' | 'concerns' | 'reject' | null;
    summary: string;
  }): Promise<void>;
  /** The latest CI state of the pull request; called as it changes. */
  saveCi(progress: AutomationCiProgress): Promise<void>;
}
