import { AnalyticsAgentOutcome } from '../dto/analytics-agent.dto';

/**
 * The parts of one analytical-agent run (`invokeAnalyticalAgent`'s trace) that the
 * `/ask` response is built from: every `execute_sql` call it made, how long the run
 * took and which model answered.
 */
export interface AgentRunSummary {
  durationMs: number;
  config: { model: string };
  sqlQueries: {
    status: 'success' | 'error';
    columns: { name: string }[] | null;
    rows: unknown[] | null;
    rowsSampled: boolean;
  }[];
}

export interface AgentRunResultFields {
  outcome: AnalyticsAgentOutcome;
  message: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  provenance: {
    plannerModel: string;
    answerModel: string;
    promptVersion: string;
  };
}

const isPlainRow = (row: unknown): row is Record<string, unknown> =>
  typeof row === 'object' && row !== null && !Array.isArray(row);

/**
 * The structured fields of the `/ask` response for a run: the table the answer is
 * backed by (the LAST query that ran successfully), and the outcome.
 *
 * The agent answers in prose and does not choose between clarify / refuse / reject, so
 * those outcomes cannot be told apart from here. What can be told is whether the answer
 * has data behind it: when the agent ran SQL and every query failed, the outcome is
 * `failed`; otherwise `answer`. The agent's text is the `answer` in both cases.
 */
export function resultFieldsFromRun(
  run: AgentRunSummary,
): AgentRunResultFields {
  const succeeded = run.sqlQueries.filter((q) => q.status === 'success');
  const last = succeeded[succeeded.length - 1];
  const failed = run.sqlQueries.length > 0 && succeeded.length === 0;

  // Rows are only shown when they came back keyed by column name.
  const rows = (last?.rows ?? []).filter(isPlainRow);
  const columns = (last?.columns ?? []).map((c) => c.name);
  const shown = columns.length > 0 && rows.length > 0;

  return {
    outcome: failed
      ? AnalyticsAgentOutcome.FAILED
      : AnalyticsAgentOutcome.ANSWER,
    message: failed
      ? 'The query could not be run, so this answer is not backed by data.'
      : '',
    columns: shown ? columns : [],
    rows: shown ? rows : [],
    // "Rows returned after the cap": `truncated` says there were more.
    rowCount: shown ? rows.length : 0,
    truncated: shown && last.rowsSampled,
    durationMs: run.durationMs,
    provenance: {
      plannerModel: run.config.model,
      answerModel: run.config.model,
      promptVersion: '',
    },
  };
}
