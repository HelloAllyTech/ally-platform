/**
 * SQL for facts a debrief run keeps both as a real column and, still, inside `workspace`
 * (2026-11-19): the judge's overall score, model and prompt version, how the language was found,
 * and the retry count. The column wins; the `workspace` copy is the fallback for a row written
 * before the columns existed or by an older ally-be still running during a deploy. `alias` is the
 * `debrief_runs` alias in the query ('' when it has none).
 */
const p = (alias: string) => (alias ? `${alias}.` : '');

export const judgeOverallSql = (alias = '') =>
  `COALESCE(${p(alias)}"judgeOverall"::float, (${p(alias)}workspace->'judge'->>'overall')::float)`;

export const judgeModelSql = (alias = '') =>
  `COALESCE(${p(alias)}"judgeModel", ${p(alias)}workspace->'judge'->>'model')`;

export const judgePromptVersionSql = (alias = '') =>
  `COALESCE(${p(alias)}"judgePromptVersion", ${p(alias)}workspace->'judge'->>'promptVersion')`;

export const languageSourceSql = (alias = '') =>
  `COALESCE(${p(alias)}"languageSource", ${p(alias)}workspace->>'languageSource')`;

/** The larger of the column and the `workspace` copy, so an older instance's increment still counts. */
export const retriesSql = (alias = '') =>
  `GREATEST(COALESCE(${p(alias)}"retries", 0), COALESCE((${p(alias)}workspace->>'retries')::int, 0))`;
