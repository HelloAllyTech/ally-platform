import { DebriefRecipeKey } from '../constants/debrief-release.constants';
import { DEBRIEF_GUIDELINE_LEVELS } from '../../context-library/profiles/debrief-guidance.profile';

/**
 * The Console's metric filters — one set, applied to every live metric, and the
 * same set the eval surface uses so a test-set number and a live number can be
 * cut the same way: organisation, language, learner level, recipe, release
 * version, judge version — and the segments the Analytics tab used to list as
 * breakdowns: skill, scenario, course, session length, step model and risk.
 */
export interface MetricsFilter {
  tenantId?: string;
  language?: string;
  learnerLevel?: string;
  recipe?: string;
  releaseVersion?: number;
  /** "model/promptVersion", as the judge stamps it. */
  judgeVersion?: string;
  /** A skill named anywhere on the debrief's cards (as `cardSkills` reads them). */
  skill?: string;
  scenarioId?: number;
  /** A course (track) that holds the session's scenario. */
  courseId?: number;
  /** One of `SESSION_LENGTH_BANDS`, by learner turns (`lengthBand`). */
  sessionLength?: string;
  /** "<step>: <model>" — a step that finished on that model (`stepModelKeys`). */
  stepModel?: string;
  /** Whether the safety reader found a client risk cue. */
  risk?: 'risk' | 'no_risk';
}

/** The learner-turn bands, in order, with the turn range each covers (must match `lengthBand`; the spec checks). */
export const SESSION_LENGTH_BANDS: ReadonlyArray<{
  band: string;
  min: number;
  max: number | null;
}> = [
  { band: '1-5', min: 0, max: 5 },
  { band: '6-15', min: 6, max: 15 },
  { band: '16-30', min: 16, max: 30 },
  { band: '31+', min: 31, max: null },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const JUDGE_VERSION = /^[A-Za-z0-9._:+-]{1,80}\/[A-Za-z0-9._:+-]{1,40}$/;
const STEP_MODEL = /^[a-z_]{1,40}: [A-Za-z0-9._:/ ()+-]{1,80}$/;
/** Free text (a skill name): no control characters, bounded. Escaped as a literal below. */
const PLAIN = /^[^\u0000-\u001f]{1,120}$/;
const positiveInt = (x: string) => {
  const n = Number(x);
  return x !== '' && Number.isInteger(n) && n > 0 && n < 2 ** 31
    ? n
    : undefined;
};

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
  if (PLAIN.test(str('skill'))) f.skill = str('skill');
  const scenarioId = positiveInt(str('scenarioId'));
  if (scenarioId) f.scenarioId = scenarioId;
  const courseId = positiveInt(str('courseId'));
  if (courseId) f.courseId = courseId;
  if (SESSION_LENGTH_BANDS.some((b) => b.band === str('sessionLength'))) {
    f.sessionLength = str('sessionLength');
  }
  if (STEP_MODEL.test(str('stepModel'))) f.stepModel = str('stepModel');
  if (str('risk') === 'risk' || str('risk') === 'no_risk') {
    f.risk = str('risk') as 'risk' | 'no_risk';
  }
  return f;
}

/** The filters that only narrow the pass rate (they were its breakdowns). */
export const PASS_RATE_SEGMENT_KEYS = [
  'skill',
  'scenarioId',
  'courseId',
  'sessionLength',
  'stepModel',
  'risk',
] as const;

/** The page-wide part of a filter: everything except the pass-rate segments. */
export function pageFilter(f: MetricsFilter): MetricsFilter {
  const out: MetricsFilter = { ...f };
  for (const k of PASS_RATE_SEGMENT_KEYS) delete out[k];
  return out;
}

/** A SQL string literal for a value already validated above. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A jsonb array at `path`, or an empty one when the value is missing or not an array. */
const arr = (path: string) =>
  `(CASE WHEN jsonb_typeof(${path}) = 'array' THEN ${path} ELSE '[]'::jsonb END)`;

/** Every skill named on a run's cards, as SQL rows `sk` — the same places `cardSkills` reads. */
export const cardSkillsSql = (r: string) => `(
      SELECT x->>'skill' AS sk FROM jsonb_array_elements(${arr(`${r}.cards->'what_worked'`)}) x
      UNION ALL SELECT x->>'skill' FROM jsonb_array_elements(${arr(`${r}.cards->'work_on_this'`)}) x
      UNION ALL SELECT ${r}.cards->'practise_next'->>'skill'
      UNION ALL SELECT x->>'skill' FROM jsonb_array_elements(${arr(`${r}.cards->'skill_words'`)}) x
    )`;

/**
 * The filter as SQL conditions (each prefixed with AND), over a run `r`,
 * its session `s` and the learner `u` (users, joined on s."counselorId").
 * Every value is validated by `parseMetricsFilter` before it gets here.
 */
export function metricsFilterSql(
  f: MetricsFilter,
  a: { run: string; user: string; session?: string } = {
    run: 'r',
    user: 'u',
  },
): string {
  const r = a.run;
  const u = a.user;
  const ss = a.session ?? 's';
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
  if (f.skill) {
    parts.push(
      `EXISTS (SELECT 1 FROM ${cardSkillsSql(r)} k WHERE k.sk = ${lit(f.skill)})`,
    );
  }
  if (f.scenarioId) parts.push(`${ss}."scenarioId" = ${f.scenarioId}`);
  if (f.courseId) {
    parts.push(
      `EXISTS (SELECT 1 FROM track_items ti WHERE ti."scenarioId" = ${ss}."scenarioId" AND ti."trackId" = ${f.courseId})`,
    );
  }
  const band = SESSION_LENGTH_BANDS.find((b) => b.band === f.sessionLength);
  if (band) {
    parts.push(
      `${r}."learnerTurns" >= ${band.min}` +
        (band.max == null ? '' : ` AND ${r}."learnerTurns" <= ${band.max}`),
    );
  }
  if (f.stepModel) {
    const at = f.stepModel.indexOf(': ');
    parts.push(
      `EXISTS (SELECT 1 FROM jsonb_array_elements(${arr(`${r}.steps`)}) st
                WHERE st->>'status' = 'done' AND st->>'step' = ${lit(f.stepModel.slice(0, at))}
                  AND st->>'model' = ${lit(f.stepModel.slice(at + 2))})`,
    );
  }
  if (f.risk) {
    parts.push(
      f.risk === 'risk'
        ? `${r}."hasRiskCue" IS TRUE`
        : `${r}."hasRiskCue" IS FALSE`,
    );
  }
  return parts.map((p) => ` AND ${p}`).join('');
}
