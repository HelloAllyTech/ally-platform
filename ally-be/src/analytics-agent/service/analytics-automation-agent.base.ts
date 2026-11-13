import { ChatOpenAI } from '@langchain/openai';
import { createAgent, HumanMessage, toolStrategy } from 'langchain';
import type { z } from 'zod';
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

let llm: ChatOpenAI | undefined;

/**
 * Same model and settings as the Analytics Agent, built on first use so that
 * importing this file (and every suite that loads the module) needs no env.
 */
export function automationLlm(): ChatOpenAI {
  llm ??= new ChatOpenAI({
    model: process.env.OPENAI_CHAT_MODEL,
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
  const result = await agent.invoke(
    { messages: [new HumanMessage(opts.input)] },
    { recursionLimit: AUTOMATION_LIMITS.RECURSION_LIMIT },
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
}
