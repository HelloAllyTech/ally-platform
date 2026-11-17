import { LlmTask } from 'src/learn/enum/llm-task.enum';

/**
 * The measurable-metric catalog (docs/pm-agent.md "Contract addendum: impact checks").
 *
 * A CLOSED allow-list: a recommendation's `metricRef.source` must be one of these keys, or the
 * card fails the payload contract. Each entry reads ONE number for a window from an existing
 * read-only Analytics aggregate (the same service the Analytics tab and the lanes use), so an
 * impact check measures exactly what the dashboard shows, nothing invented here.
 *
 * Rules every entry keeps:
 *  - platform-wide: no tenantId is ever passed (no tenant can be singled out in a public PRD,
 *    and a per-tenant number would be a small-group figure);
 *  - bounded: the window is always 14 days (`PM_IMPACT.WINDOW_DAYS`);
 *  - one number plus the volume behind it (`sampleSize`), so a thin window is reported as
 *    `insufficient_data` instead of a verdict;
 *  - a null value (the service suppressed a rate below its own minimum population, or there
 *    was no data) is returned as `value: null`, which the verdict logic treats as too little
 *    data — never as zero.
 *
 * Entries were chosen because the service exposes a windowed SUMMARY figure. Left out on
 * purpose: activation rate (all-time by construction: the date picker does not move it), the
 * six all-time sections (org health, usage levels, volume per learner, skill growth,
 * competency map, track drop-off), and anything only available per tenant.
 */

export type PmMetricUnit = 'percent' | 'count' | 'ms' | 'usd' | 'ratio';
export type PmBetterWhen = 'up' | 'down';
export const PM_METRIC_UNITS: readonly PmMetricUnit[] = [
  'percent',
  'count',
  'ms',
  'usd',
  'ratio',
];

/** What a card carries (payload `metricRef`). */
export interface PmMetricRef {
  source: string;
  params?: Record<string, string>;
  unit?: PmMetricUnit;
  betterWhen: PmBetterWhen;
}

/** A read window: UTC calendar days, both ends INCLUSIVE (the Analytics `from`/`to`). */
export interface PmMetricWindow {
  from: string;
  to: string;
}

export interface PmMetricReading {
  /** Null = the source had no figure (no data, or a rate it suppresses below its minimum). */
  value: number | null;
  /** The volume the value stands on (sessions, learners, turns, calls). */
  sampleSize: number;
}

export type PmMetricReadResult =
  | ({ status: 'ok' } & PmMetricReading)
  | { status: 'unavailable'; error: string };

type WindowQuery = { from: string; to: string };

/**
 * The read-only sources the catalog is built from. Structural on purpose (only the summary
 * fields used), so tests pass fakes and the real adapter (PmMetricSourcesService) is a thin
 * shim over the Analytics services.
 */
export interface PmMetricSources {
  overview(q: WindowQuery): Promise<{
    summary: {
      activeUsers: number;
      simulationsCompleted: number;
      retentionRatePct: number | null;
    };
  }>;
  completionRate(q: WindowQuery): Promise<{
    summary: { started: number; completionRatePct: number | null };
  }>;
  qualityDistribution(q: WindowQuery): Promise<{
    summary: {
      evaluatedSessions: number;
      medianScore: number | null;
      responses: number;
      avgRating: number | null;
    };
  }>;
  coachingLoop(q: WindowQuery): Promise<{
    summary: { completedSessions: number; sharePct: number | null };
  }>;
  scribeAdoption(q: WindowQuery): Promise<{
    summary: { sessions: number; counsellors: number };
  }>;
  voiceLatency(q: WindowQuery): Promise<{
    overall: { turns: number; p95Ms: number | null };
  }>;
  /** Priced `llm_usage` for the window, optionally for one task. */
  llmUsage(
    window: PmMetricWindow,
    task?: string,
  ): Promise<{ costUsd: number; calls: number }>;
}

interface PmMetricParamSpec {
  description: string;
  required: boolean;
  check: (value: unknown) => boolean;
}

export interface PmMetricDefinition {
  key: string;
  label: string;
  unit: PmMetricUnit;
  betterWhen: PmBetterWhen;
  /** One line for the lane prompt: what the number is and where it comes from. */
  description: string;
  /** Below this sample a read is `insufficient_data`. */
  minSample: number;
  params?: Record<string, PmMetricParamSpec>;
  read(
    window: PmMetricWindow,
    params: Record<string, string>,
    sources: PmMetricSources,
  ): Promise<PmMetricReading>;
}

const LLM_TASKS: ReadonlySet<string> = new Set(Object.values(LlmTask));
const taskParam = (required: boolean): PmMetricParamSpec => ({
  description: 'an LlmTask value (the `task` column of llm_usage)',
  required,
  check: (value) => typeof value === 'string' && LLM_TASKS.has(value),
});

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const count = (value: unknown): number => num(value) ?? 0;

const q = (window: PmMetricWindow): WindowQuery => ({
  from: window.from,
  to: window.to,
});

export const PM_METRIC_CATALOG: readonly PmMetricDefinition[] = [
  {
    // CompletionRateAnalyticsService summary: completed ÷ started roleplays in the window.
    key: 'roleplay_completion_rate',
    label: 'Roleplay completion rate',
    unit: 'percent',
    betterWhen: 'up',
    description:
      'Share of roleplays started in the window that were completed (Analytics: completion rate).',
    minSample: 30,
    read: async (window, _params, sources) => {
      const { summary } = await sources.completionRate(q(window));
      return {
        value: num(summary?.completionRatePct),
        sampleSize: count(summary?.started),
      };
    },
  },
  {
    // PlatformAnalyticsService overview summary: returning active users ÷ active users.
    key: 'returning_user_rate',
    label: 'Returning users',
    unit: 'percent',
    betterWhen: 'up',
    description:
      'Share of users active in the window who were returning users (Analytics overview: retention).',
    minSample: 20,
    read: async (window, _params, sources) => {
      const { summary } = await sources.overview(q(window));
      return {
        value: num(summary?.retentionRatePct),
        sampleSize: count(summary?.activeUsers),
      };
    },
  },
  {
    // Overview summary: distinct users active in the window.
    key: 'active_users',
    label: 'Active users',
    unit: 'count',
    betterWhen: 'up',
    description:
      'Distinct users active in the window, platform-wide (Analytics overview).',
    minSample: 20,
    read: async (window, _params, sources) => {
      const { summary } = await sources.overview(q(window));
      const value = num(summary?.activeUsers);
      return { value, sampleSize: count(value) };
    },
  },
  {
    // Overview summary: simulations completed in the window.
    key: 'simulations_completed',
    label: 'Roleplays completed',
    unit: 'count',
    betterWhen: 'up',
    description:
      'Roleplay simulations completed in the window, platform-wide (Analytics overview).',
    minSample: 20,
    read: async (window, _params, sources) => {
      const { summary } = await sources.overview(q(window));
      const value = num(summary?.simulationsCompleted);
      return { value, sampleSize: count(value) };
    },
  },
  {
    // QualityDistributionAnalyticsService: median judge composite over evaluated sessions
    // (the analytics composite, not the learner's own score). Null below its own minimum.
    key: 'roleplay_median_quality',
    label: 'Median roleplay quality score',
    unit: 'ratio',
    betterWhen: 'up',
    description:
      'Median evaluated quality score of roleplays in the window (Analytics: score distribution).',
    minSample: 30,
    read: async (window, _params, sources) => {
      const { summary } = await sources.qualityDistribution(q(window));
      return {
        value: num(summary?.medianScore),
        sampleSize: count(summary?.evaluatedSessions),
      };
    },
  },
  {
    // Quality distribution: mean of raw 1–5 learner ratings in the window.
    key: 'learner_avg_rating',
    label: 'Average learner rating',
    unit: 'ratio',
    betterWhen: 'up',
    description:
      'Mean 1–5 rating learners gave roleplays in the window (Analytics: score distribution).',
    minSample: 20,
    read: async (window, _params, sources) => {
      const { summary } = await sources.qualityDistribution(q(window));
      return {
        value: num(summary?.avgRating),
        sampleSize: count(summary?.responses),
      };
    },
  },
  {
    // CoachingLoopAnalyticsService: completed sessions shared for review ÷ completed.
    key: 'coaching_share_rate',
    label: 'Sessions shared for review',
    unit: 'percent',
    betterWhen: 'up',
    description:
      'Share of completed sessions shared for coaching review in the window (Analytics: coaching loop).',
    minSample: 30,
    read: async (window, _params, sources) => {
      const { summary } = await sources.coachingLoop(q(window));
      return {
        value: num(summary?.sharePct),
        sampleSize: count(summary?.completedSessions),
      };
    },
  },
  {
    // ScribeAdoptionAnalyticsService: scribe sessions in the window.
    key: 'scribe_sessions',
    label: 'Scribe sessions',
    unit: 'count',
    betterWhen: 'up',
    description:
      'Scribe sessions recorded in the window, platform-wide (Analytics: scribe adoption).',
    minSample: 10,
    read: async (window, _params, sources) => {
      const { summary } = await sources.scribeAdoption(q(window));
      const value = num(summary?.sessions);
      return { value, sampleSize: count(value) };
    },
  },
  {
    // PlatformAnalyticsService.getVoiceLatency overall: p95 voice-to-voice over live turns.
    key: 'voice_latency_p95_ms',
    label: 'Voice reply latency (p95)',
    unit: 'ms',
    betterWhen: 'down',
    description:
      'p95 voice-to-voice reply latency of live roleplay turns in the window (Analytics: voice latency).',
    minSample: 200,
    read: async (window, _params, sources) => {
      const { overall } = await sources.voiceLatency(q(window));
      return {
        value: num(overall?.p95Ms),
        sampleSize: count(overall?.turns),
      };
    },
  },
  {
    // llm_usage priced with the shared pricing table (the same maths as the budget meter).
    key: 'llm_cost_usd',
    label: 'Model spend',
    unit: 'usd',
    betterWhen: 'down',
    description:
      'Model spend in the window from llm_usage; params.task narrows it to one AI task.',
    minSample: 20,
    params: { task: taskParam(false) },
    read: async (window, params, sources) => {
      const { costUsd, calls } = await sources.llmUsage(window, params.task);
      return { value: num(costUsd), sampleSize: count(calls) };
    },
  },
  {
    // Cost ÷ calls for ONE task: an efficiency figure that volume does not move.
    key: 'llm_cost_per_call_usd',
    label: 'Model cost per call',
    unit: 'usd',
    betterWhen: 'down',
    description:
      'Average model cost per call of one AI task in the window (llm_usage); params.task is required.',
    minSample: 20,
    params: { task: taskParam(true) },
    read: async (window, params, sources) => {
      const { costUsd, calls } = await sources.llmUsage(window, params.task);
      const n = count(calls);
      return { value: n > 0 ? count(costUsd) / n : null, sampleSize: n };
    },
  },
];

const BY_KEY: ReadonlyMap<string, PmMetricDefinition> = new Map(
  PM_METRIC_CATALOG.map((entry) => [entry.key, entry]),
);

export const PM_METRIC_KEYS: readonly string[] = PM_METRIC_CATALOG.map(
  (entry) => entry.key,
);

export function metricDefinition(
  source: unknown,
): PmMetricDefinition | undefined {
  return typeof source === 'string' ? BY_KEY.get(source) : undefined;
}

/**
 * Problems with a `metricRef` (empty = valid): source in the catalog, params exactly the
 * entry's (no unknown keys, required present, each value checked), unit (when sent) equal to
 * the entry's, betterWhen up|down. Messages are phrased for the lane's repair pass.
 */
export function metricRefProblems(ref: unknown): string[] {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    return ['metricRef: must be an object'];
  }
  const input = ref as Record<string, unknown>;
  const problems: string[] = [];
  const allowedKeys = new Set(['source', 'params', 'unit', 'betterWhen']);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) problems.push(`metricRef.${key}: not allowed`);
  }
  const definition = metricDefinition(input.source);
  if (!definition) {
    problems.push(
      `metricRef.source: "${String(input.source).slice(0, 60)}" is not in the measurable-metric catalog`,
    );
  }
  if (input.betterWhen !== 'up' && input.betterWhen !== 'down') {
    problems.push('metricRef.betterWhen: must be "up" or "down"');
  }
  if (input.unit !== undefined) {
    if (!PM_METRIC_UNITS.includes(input.unit as PmMetricUnit)) {
      problems.push(
        `metricRef.unit: must be one of ${PM_METRIC_UNITS.join(', ')}`,
      );
    } else if (definition && input.unit !== definition.unit) {
      problems.push(
        `metricRef.unit: ${definition.key} is measured in ${definition.unit}`,
      );
    }
  }
  const params = input.params;
  if (
    params !== undefined &&
    (!params || typeof params !== 'object' || Array.isArray(params))
  ) {
    problems.push('metricRef.params: must be an object');
  } else if (definition) {
    const given = (params ?? {}) as Record<string, unknown>;
    const spec = definition.params ?? {};
    for (const key of Object.keys(given)) {
      if (!spec[key]) {
        problems.push(
          `metricRef.params.${key}: ${definition.key} takes no such parameter`,
        );
      } else if (!spec[key].check(given[key])) {
        problems.push(
          `metricRef.params.${key}: must be ${spec[key].description}`,
        );
      }
    }
    for (const [key, item] of Object.entries(spec)) {
      if (item.required && given[key] === undefined) {
        problems.push(
          `metricRef.params.${key}: required (${item.description})`,
        );
      }
    }
  }
  return problems;
}

/** The catalog as the lanes see it (code-injected, so it never drifts from this file). */
export function metricCatalogBlock(): string {
  return [
    '# Measurable metrics (metricRef)',
    'A recommendation MAY carry `metricRef` { source, params?, unit?, betterWhen } naming ONE ' +
      'catalog entry below. After release the platform reads it over the 14 days before release ' +
      'and again at +14 and +30 days, and judges the card by it. Attach one only when that ' +
      'platform-wide number would genuinely move because of THIS change; otherwise leave ' +
      'metricRef out (the card is shown as "impact not measurable", which is fine). Never invent ' +
      'a source; keep impactMetric as the human-readable name.',
    ...PM_METRIC_CATALOG.map((entry) => {
      const params = Object.entries(entry.params ?? {})
        .map(
          ([key, spec]) =>
            `${key}${spec.required ? '' : '?'}: ${spec.description}`,
        )
        .join('; ');
      return `- ${entry.key} | ${entry.label} | ${entry.unit} | better ${entry.betterWhen}${
        params ? ` | params { ${params} }` : ''
      } — ${entry.description}`;
    }),
  ].join('\n');
}

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

/**
 * Read a metric for a window. NEVER throws: an unknown source, a source error or a timeout
 * is `{ status: 'unavailable' }` with the reason.
 */
export async function readMetric(
  ref: Pick<PmMetricRef, 'source' | 'params'>,
  window: PmMetricWindow,
  sources: PmMetricSources,
  timeoutMs = 60_000,
): Promise<PmMetricReadResult> {
  const definition = metricDefinition(ref?.source);
  if (!definition) {
    return {
      status: 'unavailable',
      error: `unknown metric source ${String(ref?.source)}`,
    };
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const reading = await Promise.race([
      definition.read(window, ref.params ?? {}, sources),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`read timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
    return {
      status: 'ok',
      value: num(reading?.value),
      sampleSize: Math.max(0, Math.floor(count(reading?.sampleSize))),
    };
  } catch (error) {
    return { status: 'unavailable', error: errorText(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
