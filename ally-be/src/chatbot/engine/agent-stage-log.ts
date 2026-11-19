import { AiUpstreamError } from '../../ai/exception/ai-upstream.exception';
import { agentRunIdFor } from './agent-runtime';

/**
 * Chunk H1 Part A: one log line per stage of a turn, so the time a reply takes can be split by
 * stage. `[AGENT STAGE] run=<run id> stage=<name> t_ms=<since the turn started> key=value…`.
 *
 * The run id is the one ally-ai logs its own `[AGENT STAGE]` lines under, so the two services'
 * lines join. Values are names, codes, counts and milliseconds only: never the person's words.
 */
export type StageFields = Record<string, string | number | boolean | undefined>;

export const stageLine = (
  runId: string,
  startedAt: number,
  stage: string,
  fields: StageFields = {},
): string => {
  const extra = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_')}`)
    .join(' ');
  return `[AGENT STAGE] run=${runId} stage=${stage} t_ms=${Date.now() - startedAt}${extra ? ` ${extra}` : ''}`;
};

/**
 * The run id an engine turn's lines go under: the run's own, when the message has a provider id
 * (the bot page, WhatsApp); otherwise `preview` (Try it starts a fresh random run each time).
 */
export const stageRunIdFor = (providerMessageId?: string | null): string =>
  providerMessageId ? agentRunIdFor(providerMessageId) : 'preview';

/**
 * Which component ended a failed run: ally-ai's own run cap (its `error: timeout`), ally-be's
 * stream deadline (`streamMs`), ally-be's one-attempt deadline (`attemptMs`), a caller that went
 * away (the person left, or a crisis reply went out instead), or an error.
 */
export const endedBy = (error: unknown, callerAborted: boolean): string => {
  if (callerAborted) return 'caller_aborted';
  const message = error instanceof Error ? error.message : '';
  if (error instanceof AiUpstreamError) {
    if (message === 'The agent run timed out') return 'ally-ai_run_cap';
    if (message === 'The agent stream timed out')
      return 'ally-be_stream_deadline';
  }
  if (/timeout|timed out/i.test(message)) return 'timeout_other';
  return 'error';
};
