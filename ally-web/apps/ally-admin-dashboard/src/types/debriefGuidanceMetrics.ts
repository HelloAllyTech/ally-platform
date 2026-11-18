/** `GET /v1/debriefs/console/guidance-metrics`: how the Debrief's guidance is doing. */
export type GuidanceMetricsMode = "all" | "live" | "shadow";

export type GuidanceToolName = "guidance_index" | "guidance_search" | "guidance_fetch";

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
    tool: GuidanceToolName;
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
    withAgent: { n: number; avgJudge: number | null; avgCostUsd: number | null };
    withoutAgent: { n: number; avgJudge: number | null; avgCostUsd: number | null };
  };
  daily: Array<{
    date: string;
    runs: number;
    withAgent: number;
    avgLookupMs: number | null;
    avgAgentMs: number | null;
  }>;
}

export interface GuidanceMetricsParams {
  days: number;
  mode: GuidanceMetricsMode;
}
