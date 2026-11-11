import { DebriefRecipeKey } from '../constants/debrief-release.constants';
import { DEBRIEF_GUIDELINE_LEVELS } from '../../context-library/profiles/debrief-guidance.profile';

/**
 * The Console's metric filters — one set, applied to every live metric, and the
 * same set the eval surface uses so a test-set number and a live number can be
 * cut the same way: organisation, language, learner level, recipe, release
 * version, judge version.
 */
export interface MetricsFilter {
  tenantId?: string;
  language?: string;
  learnerLevel?: string;
  recipe?: string;
  releaseVersion?: number;
  /** "model/promptVersion", as the judge stamps it. */
  judgeVersion?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const JUDGE_VERSION = /^[A-Za-z0-9._:+-]{1,80}\/[A-Za-z0-9._:+-]{1,40}$/;

/**
 * Keep only values that are well formed; anything else is dropped rather than
 * reaching SQL. Values that can only narrow a match, so being lenient is safe.
 */
export function parseMetricsFilter(q: Record<string, unknown>): MetricsFilter {
  const str = (k: string) =>
    typeof q[k] === 'string' ? (q[k] as string).trim() : '';
  const f: MetricsFilter = {};
  if (UUID.test(str('tenantId'))) f.tenantId = str('tenantId').toLowerCase();
  if (LANGUAGE.test(str('language'))) f.language = str('language');
  if (DEBRIEF_GUIDELINE_LEVELS.includes(str('learnerLevel').toLowerCase())) {
    f.learnerLevel = str('learnerLevel').toLowerCase();
  }
  if ((Object.values(DebriefRecipeKey) as string[]).includes(str('recipe'))) {
    f.recipe = str('recipe');
  }
  const v = Number(str('releaseVersion'));
  if (Number.isInteger(v) && v > 0 && v < 100000) f.releaseVersion = v;
  if (JUDGE_VERSION.test(str('judgeVersion')))
    f.judgeVersion = str('judgeVersion');
  return f;
}

/** A SQL string literal for a value already validated above. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The filter as SQL conditions (each prefixed with AND), over a run `r`,
 * its session `s` and the learner `u` (users, joined on s."counselorId").
 * Every value is validated by `parseMetricsFilter` before it gets here.
 */
export function metricsFilterSql(
  f: MetricsFilter,
  a: { run: string; user: string } = { run: 'r', user: 'u' },
): string {
  const r = a.run;
  const u = a.user;
  const parts: string[] = [];
  if (f.tenantId) parts.push(`${r}.tenant_id = ${lit(f.tenantId)}`);
  if (f.language) parts.push(`${r}.language = ${lit(f.language)}`);
  if (f.learnerLevel) {
    parts.push(
      `lower(COALESCE(${u}.metadata->>'workerType', 'LAY')) = ${lit(f.learnerLevel)}`,
    );
  }
  if (f.recipe) parts.push(`${r}."recipeKey" = ${lit(f.recipe)}`);
  if (f.releaseVersion)
    parts.push(`${r}."releaseVersion" = ${f.releaseVersion}`);
  if (f.judgeVersion) {
    parts.push(
      `(${r}.workspace->'judge'->>'model') || '/' || COALESCE(${r}.workspace->'judge'->>'promptVersion', '?') = ${lit(f.judgeVersion)}`,
    );
  }
  return parts.map((p) => ` AND ${p}`).join('');
}
