/**
 * Debrief Guidance analytics (lookup + guidance agent): pure aggregation over
 * the facts read from `debrief_runs.workspace` and `debrief_run_logs`.
 * No transcript text, quotes or learner data is ever read or returned: counts,
 * milliseconds, entry codes and (outside this file) entry titles only.
 *
 * The newer workspace fields (`guidanceMode`, `guidanceGiven`, `guidanceTimings`)
 * may be absent on older runs; absent means unknown, and each figure then falls
 * back to `guidanceCalls` and the step logs.
 */

export type GuidanceMetricsMode = 'all' | 'live' | 'shadow';

export interface GuidanceCall {
  step?: string;
  tool?: string;
  codes_returned?: unknown;
  ms?: unknown;
  ok?: unknown;
}

export interface GuidanceRunFacts {
  id: string;
  createdAt: Date | string;
  guidanceMode?: unknown;
  guidanceCalls?: unknown;
  guidanceGiven?: unknown;
  guidanceTimings?: unknown;
  /** `workspace.passages`: objects with a code/id, or bare codes. */
  passages?: unknown;
  judge?: number | string | null;
  costUsd?: number | string | null;
  /** The run's step logs we read (planner, guidance_lookup, guidance_agent). */
  logs?: GuidanceLogFacts[];
}

export interface GuidanceLogFacts {
  step: string;
  kind?: string | null;
  ms?: number | string | null;
  error?: string | null;
  /** planner output: `{ actions: [{agent}], considered: [{agent, why_not}] }` */
  actions?: unknown;
  considered?: unknown;
}

export interface GuidanceMetrics {
  window: { from: string; to: string; days: number };
  mode: GuidanceMetricsMode;
  runs: {
    total: number;
    withAgent: number;
    withLookup: number;
    agentOnly: number;
    lookupOnly: number;
    neither: number;
  };
  planner: {
    decided: number;
    chose: number;
    skipped: number;
    skipReasons: Array<{ why: string; count: number }>;
  };
  tools: Array<{
    step: string;
    tool: string;
    calls: number;
    ok: number;
    avgMs: number;
    p90Ms: number;
    avgCodes: number;
  }>;
  entries: Array<{
    code: string;
    title: string;
    kind: string | null;
    fetched: number;
    given: number;
    runs: number;
  }>;
  latency: {
    lookup: { n: number; p50Ms: number; p90Ms: number };
    agent: { n: number; p50Ms: number; p90Ms: number };
  };
  compare: {
    withAgent: CompareArm;
    withoutAgent: CompareArm;
  };
  daily: Array<{
    date: string;
    runs: number;
    withAgent: number;
    avgLookupMs: number | null;
    avgAgentMs: number | null;
  }>;
}
export interface CompareArm {
  n: number;
  avgJudge: number | null;
  avgCostUsd: number | null;
}

const AGENT = 'guidance_agent';
const LOOKUP = 'guidance_lookup';
const CODE = /^[A-Z]{2,4}-\d+$/;
const TOP_ENTRIES = 15;
const TOP_REASONS = 5;
const REASON_MAX = 200;

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : {};
const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Nearest-rank percentile (p in 0..100) of a list; 0 when empty. */
export function percentile(values: number[], p: number): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const rank = Math.ceil((p / 100) * xs.length);
  return xs[Math.min(xs.length, Math.max(1, rank)) - 1];
}

const codeOf = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v : (obj(v).code ?? obj(v).id);
  return typeof s === 'string' && CODE.test(s) ? s : null;
};

export function uniqueCodes(list: unknown): string[] {
  return [
    ...new Set(
      arr(list)
        .map(codeOf)
        .filter((c): c is string => !!c),
    ),
  ];
}

interface RunView {
  run: GuidanceRunFacts;
  day: string;
  calls: GuidanceCall[];
  usedAgent: boolean;
  usedLookup: boolean;
  lookupMs: number | null;
  agentMs: number | null;
  given: string[];
}

function view(run: GuidanceRunFacts): RunView {
  const calls = arr(run.guidanceCalls).filter(
    (c) => c && typeof c === 'object',
  ) as GuidanceCall[];
  const logs = run.logs ?? [];
  const mode = typeof run.guidanceMode === 'string' ? run.guidanceMode : null;
  const timings = obj(run.guidanceTimings);

  // The real node's log (kind model) tells a run that ran the agent from the
  // planner's marker entry, which carries no work.
  const agentLog = logs.find(
    (l) => l.step === AGENT && l.kind === 'model' && !l.error,
  );
  const lookupLog = logs.find((l) => l.step === LOOKUP && !l.error);

  const agentCalls = calls.filter((c) => c.step === AGENT);
  const lookupCalls = calls.filter((c) => c.step === LOOKUP);
  let usedAgent: boolean;
  let usedLookup: boolean;
  if (
    mode === 'both' ||
    mode === 'lookup' ||
    mode === 'agent' ||
    mode === 'none'
  ) {
    usedAgent = mode === 'both' || mode === 'agent';
    usedLookup = mode === 'both' || mode === 'lookup';
  } else {
    usedAgent = agentCalls.length > 0 || !!agentLog;
    usedLookup = lookupCalls.length > 0 || !!lookupLog;
  }

  const lookupMs =
    num(timings.lookupMs) ??
    num(lookupLog?.ms) ??
    (lookupCalls.length
      ? lookupCalls.reduce((a, c) => a + (num(c.ms) ?? 0), 0)
      : null);
  const agentMs =
    num(timings.agentMs) ??
    num(agentLog?.ms) ??
    (agentCalls.length
      ? agentCalls.reduce((a, c) => a + (num(c.ms) ?? 0), 0)
      : null);

  const given = Array.isArray(run.guidanceGiven)
    ? uniqueCodes(run.guidanceGiven)
    : uniqueCodes(run.passages);

  const at = new Date(run.createdAt);
  return {
    run,
    day: at.toISOString().slice(0, 10),
    calls,
    usedAgent,
    usedLookup,
    lookupMs: usedLookup ? lookupMs : null,
    agentMs: usedAgent ? agentMs : null,
    given,
  };
}

/** What the planner did about the guidance agent in one run: null when it never ruled on it. */
function plannerVerdict(
  run: GuidanceRunFacts,
): { chose: true } | { chose: false; why: string } | null {
  let skip: string | null = null;
  for (const l of (run.logs ?? []).filter((x) => x.step === 'planner')) {
    if (arr(l.actions).some((a) => obj(a).agent === AGENT))
      return { chose: true };
    const c = arr(l.considered).find((x) => obj(x).agent === AGENT);
    if (c && skip == null) {
      const why = String(obj(c).why_not ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      skip = why.slice(0, REASON_MAX) || 'No reason given';
    }
  }
  return skip == null ? null : { chose: false, why: skip };
}

export interface AggregateInput {
  runs: GuidanceRunFacts[];
  from: Date;
  to: Date;
  days: number;
  mode: GuidanceMetricsMode;
  /** code -> title/kind, from cl_chunks. */
  chunks?: Map<string, { title: string; kind: string | null }>;
}

/** Entry codes the aggregation will need titles for. */
export function entryCodesOf(runs: GuidanceRunFacts[]): string[] {
  const out = new Set<string>();
  for (const r of runs) {
    const v = view(r);
    v.given.forEach((c) => out.add(c));
    for (const c of v.calls) {
      if (c.tool === 'guidance_fetch')
        uniqueCodes(c.codes_returned).forEach((x) => out.add(x));
    }
  }
  return [...out];
}

export function aggregateGuidanceMetrics(inp: AggregateInput): GuidanceMetrics {
  const views = inp.runs.map(view);

  const runs = {
    total: views.length,
    withAgent: views.filter((v) => v.usedAgent).length,
    withLookup: views.filter((v) => v.usedLookup).length,
    agentOnly: views.filter((v) => v.usedAgent && !v.usedLookup).length,
    lookupOnly: views.filter((v) => !v.usedAgent && v.usedLookup).length,
    neither: views.filter((v) => !v.usedAgent && !v.usedLookup).length,
  };

  // Planner
  let chose = 0;
  let skipped = 0;
  const reasons = new Map<string, number>();
  for (const r of inp.runs) {
    const p = plannerVerdict(r);
    if (!p) continue;
    if (p.chose) chose++;
    else {
      skipped++;
      reasons.set(p.why, (reasons.get(p.why) ?? 0) + 1);
    }
  }
  const skipReasons = [...reasons]
    .map(([why, count]) => ({ why, count }))
    .sort((a, b) => b.count - a.count || a.why.localeCompare(b.why))
    .slice(0, TOP_REASONS);

  // Tools (one row per step + tool)
  const byTool = new Map<
    string,
    { step: string; tool: string; ms: number[]; ok: number; codes: number[] }
  >();
  for (const v of views) {
    for (const c of v.calls) {
      if (typeof c.step !== 'string' || typeof c.tool !== 'string') continue;
      const k = `${c.step}\u0000${c.tool}`;
      const row = byTool.get(k) ?? {
        step: c.step,
        tool: c.tool,
        ms: [],
        ok: 0,
        codes: [],
      };
      row.ms.push(num(c.ms) ?? 0);
      if (c.ok === true) row.ok++;
      row.codes.push(arr(c.codes_returned).length);
      byTool.set(k, row);
    }
  }
  const tools = [...byTool.values()]
    .map((r) => ({
      step: r.step,
      tool: r.tool,
      calls: r.ms.length,
      ok: r.ok,
      avgMs: round(mean(r.ms) ?? 0),
      p90Ms: round(percentile(r.ms, 90)),
      avgCodes: round(mean(r.codes) ?? 0, 1),
    }))
    .sort(
      (a, b) => a.step.localeCompare(b.step) || a.tool.localeCompare(b.tool),
    );

  // Entries: fetched = times a guidance_fetch handed the code back; given = runs where
  // it reached the Writer; runs = runs where it was fetched or given.
  const entry = new Map<
    string,
    { fetched: number; given: number; runs: number }
  >();
  const bump = (code: string) =>
    entry.get(code) ??
    entry.set(code, { fetched: 0, given: 0, runs: 0 }).get(code)!;
  for (const v of views) {
    const seen = new Set<string>();
    for (const c of v.calls) {
      if (c.tool !== 'guidance_fetch') continue;
      for (const code of arr(c.codes_returned).map(codeOf)) {
        if (!code) continue;
        bump(code).fetched++;
        seen.add(code);
      }
    }
    for (const code of v.given) {
      bump(code).given++;
      seen.add(code);
    }
    for (const code of seen) bump(code).runs++;
  }
  const entries = [...entry]
    .map(([code, e]) => ({
      code,
      title: inp.chunks?.get(code)?.title ?? code,
      kind: inp.chunks?.get(code)?.kind ?? null,
      ...e,
    }))
    .sort(
      (a, b) =>
        b.given - a.given ||
        b.fetched - a.fetched ||
        a.code.localeCompare(b.code),
    )
    .slice(0, TOP_ENTRIES);

  // Latency
  const lk = views.map((v) => v.lookupMs).filter((x): x is number => x != null);
  const ag = views.map((v) => v.agentMs).filter((x): x is number => x != null);
  const lat = (xs: number[]) => ({
    n: xs.length,
    p50Ms: round(percentile(xs, 50)),
    p90Ms: round(percentile(xs, 90)),
  });

  // With / without the agent
  const arm = (vs: RunView[]): CompareArm => {
    const j = vs
      .map((v) => num(v.run.judge))
      .filter((x): x is number => x != null);
    const c = vs
      .map((v) => num(v.run.costUsd))
      .filter((x): x is number => x != null);
    const mj = mean(j);
    const mc = mean(c);
    return {
      n: vs.length,
      avgJudge: mj == null ? null : round(mj, 2),
      avgCostUsd: mc == null ? null : round(mc, 4),
    };
  };

  // Daily
  const days = new Map<string, RunView[]>();
  for (const v of views) days.set(v.day, [...(days.get(v.day) ?? []), v]);
  const avgOrNull = (xs: Array<number | null>) => {
    const m = mean(xs.filter((x): x is number => x != null));
    return m == null ? null : round(m);
  };
  const daily = [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vs]) => ({
      date,
      runs: vs.length,
      withAgent: vs.filter((v) => v.usedAgent).length,
      avgLookupMs: avgOrNull(vs.map((v) => v.lookupMs)),
      avgAgentMs: avgOrNull(vs.map((v) => v.agentMs)),
    }));

  return {
    window: {
      from: inp.from.toISOString(),
      to: inp.to.toISOString(),
      days: inp.days,
    },
    mode: inp.mode,
    runs,
    planner: { decided: chose + skipped, chose, skipped, skipReasons },
    tools,
    entries,
    latency: { lookup: lat(lk), agent: lat(ag) },
    compare: {
      withAgent: arm(views.filter((v) => v.usedAgent)),
      withoutAgent: arm(views.filter((v) => !v.usedAgent)),
    },
    daily,
  };
}

/** `days` 1–90 (default 30); `mode` all|live|shadow (default all). */
export function parseGuidanceMetricsQuery(q: {
  days?: unknown;
  mode?: unknown;
}): {
  days: number;
  mode: GuidanceMetricsMode;
} {
  const d = Number(q?.days);
  const days = Number.isInteger(d) && d >= 1 && d <= 90 ? d : 30;
  const mode = q?.mode === 'live' || q?.mode === 'shadow' ? q.mode : 'all';
  return { days, mode };
}
