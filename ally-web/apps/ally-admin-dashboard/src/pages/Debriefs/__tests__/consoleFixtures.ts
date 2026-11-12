import { vi } from "vitest";

/** Shared fixtures for the Debriefs console suites. */

export const ok = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: undefined,
  refetch: vi.fn(),
});
export const resolves = (v: unknown = {}) => ({ unwrap: () => Promise.resolve(v) });
export const rejects = () => ({ unwrap: () => Promise.reject(new Error("")) });

export const TEAM_PERMS = ["system:access"];
export const ADVISOR_PERMS = ["review:admin:debriefs"];
export const OWNER_PERMS = ["manage:admin:debrief-settings"];

export const OVERVIEW = {
  windowDays: 7,
  mode: "shadow",
  release: { id: "r2", version: 2 },
  runs: {
    total: 12,
    published: 9,
    belowBar: 1,
    needsPerson: 2,
    failed: 0,
    skipped: 3,
    withRiskCue: 1,
  },
  judge: { scored: 12, mean: 8.6, passRate: 0.75, todayMean: 6.1, todayScored: 40 },
  costUsd: { p50: 0.09, p90: 0.21 },
  seconds: { p50: 70, p90: 110 },
  budget: {
    monthSpentUsd: 3.2,
    monthlyCapUsd: 500,
    runCeilingUsd: 0.5,
    learningSpentUsd: 4,
    learningBudgetUsd: 150,
  },
  testSets: { debrief_open: 38, debrief_gate: 24, debrief_sealed: 11 },
  liveTenants: [],
};

export const runRow = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  scenarioSessionId: "sess-1",
  mode: "live",
  status: "published",
  skipReason: null,
  recipeKey: "standard",
  releaseVersion: 2,
  language: "en",
  learnerTurns: 12,
  hasRiskCue: false,
  learnerDistress: false,
  fallbackRung: 0,
  revisionRounds: 1,
  evaluatorOverall: 8.1,
  judgeOverall: 9.0,
  costUsd: 0.08,
  seconds: 50,
  checkFailureCount: 0,
  experimentId: null,
  arm: "baseline",
  createdAt: "2026-11-12T08:00:00Z",
  tenantName: "Sangath",
  scenarioName: null,
  ...over,
});

export const reviewRun = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  scenarioSessionId: "sess-1",
  status: "needs_person",
  skipReason: null,
  language: "en",
  hasRiskCue: true,
  learnerDistress: false,
  evaluatorOverall: "6.40",
  judgeOverall: 6.4,
  checkFailures: [],
  evaluatorHardFails: [{ code: "missed_risk_cue", evidence: "turn 2" }],
  createdAt: "2026-11-12T08:00:00Z",
  tenantName: "Sangath",
  escalation: null,
  judgeBelowBar: false,
  judgeHardFails: null,
  ...over,
});

export const flag = (over: Record<string, unknown> = {}) => ({
  id: "flag-1",
  runId: "run-1",
  scenarioSessionId: "sess-1",
  section: "work_on_this[0]",
  reason: "advice_doesnt_fit",
  note: "She never said anything about harming herself.",
  urgent: true,
  status: "open",
  createdAt: "2026-11-12T09:00:00Z",
  language: "en",
  tenantName: "Sangath",
  cardText: "Ask about safety.",
  card: { lead: "Ask about safety", why: "It keeps them safe.", try_saying: "Are you safe?" },
  ...over,
});

export const IDEA = {
  id: "cccccccc-0000-4000-8000-000000000003",
  status: "proposed",
  title: "Put the risk-cue point first",
  change: {
    ideaKind: "prompt_edit",
    promptCode: "debrief_writer_system",
    find: "most important first",
    replace: "most important first; a missed risk cue always first",
    settingKey: null,
    settingValue: null,
  },
  evidence: {
    hypothesis: "Prioritisation is the weakest dimension.",
    evidence: "prioritisation 6.9",
    expectedEffect: "prioritisation +0.5",
    screen: {
      status: "done",
      cases: 6,
      pairs: 6,
      baselineFailures: 0,
      challengerFailures: 0,
      baselineMean: 8.4,
      challengerMean: 8.9,
      lift: 0.5,
      baselineHardFails: 0,
      challengerHardFails: 0,
      challengerCheckFailures: 0,
      costUsd: 1.2,
      passed: true,
      ranAt: "2026-10-29T10:00:00Z",
    },
  } as Record<string, unknown>,
  createdAt: "2026-10-29T10:00:00Z",
  releaseVersion: null,
  releaseStatus: null,
};

export const TRIAL_PASSED = {
  status: "passed",
  startedAt: "2026-11-01T00:00:00Z",
  comparisons: 34,
  meanDifference: 0.4,
  lower: 0.1,
  upper: 0.7,
};

export const RELEASES = [
  {
    id: "r2",
    version: 2,
    status: "ga",
    authorKind: "human",
    notes: "PM agent idea",
    createdAt: "2026-11-01T00:00:00Z",
    promotedAt: "2026-11-01T00:00:00Z",
    prompts: {},
    maxRevisionRounds: 2,
  },
  {
    id: "r1",
    version: 1,
    status: "retired",
    authorKind: "seed",
    notes: null,
    createdAt: "2026-10-01T00:00:00Z",
    promotedAt: null,
    prompts: {},
    maxRevisionRounds: 2,
  },
];

export const MODELS = {
  releaseVersion: 2,
  steps: [
    { step: "writer", model: "gemini-3-flash-preview", backupModel: "gemini-2.5-flash" },
    { step: "evaluator", model: "gemini-2.5-flash", backupModel: null },
  ],
  reply: "gemini-2.5-flash",
  judge: "gemini-2.5-pro",
  choices: {
    steps: [
      { model: "gemini-3-flash-preview", label: "Gemini 3 Flash", provider: "gemini" },
      { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini" },
      { model: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
    ],
    reply: [
      { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini" },
      { model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
    ],
  },
};

export const STEPS = [
  {
    step: "writer",
    model: "gemini-3-flash-preview",
    backupModel: "gemini-2.5-flash",
    inRecipes: ["standard", "short"],
    done: 40,
    failed: 2,
    skipped: 0,
    medianMs: 12000,
    estimatedUsd: 0.018,
    models: ["gemini-3-flash-preview"],
  },
];

export const SETTINGS = {
  values: { canaryShare: 0.3, flagReviewSlaHours: 24 },
  defaults: {},
  spec: { canaryShare: { default: 0.1, kind: "share", group: "canary" } },
  changed: [],
  baseline: null,
  updatedAt: "",
  updatedBy: null,
};
