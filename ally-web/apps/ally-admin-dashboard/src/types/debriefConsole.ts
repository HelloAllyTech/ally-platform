/**
 * The Debrief Console — mirrors ally-be `src/debrief/controller/debrief-console.controller.ts`.
 */

export type DebriefRunMode = "shadow" | "live" | "replay";
export type DebriefRunStatus =
  | "queued"
  | "running"
  | "published"
  | "below_bar"
  | "needs_person"
  | "skipped"
  | "failed";

export interface DebriefOverview {
  windowDays: number;
  mode: "off" | "shadow";
  release: { id: string; version: number } | null;
  runs: {
    total: number;
    published: number;
    belowBar: number;
    needsPerson: number;
    failed: number;
    skipped: number;
    withRiskCue: number;
  };
  judge: {
    scored: number;
    mean: number | null;
    passRate: number | null;
    todayMean: number | null;
    todayScored: number;
  };
  costUsd: { p50: number | null; p90: number | null };
  seconds: { p50: number | null; p90: number | null };
  budget: {
    monthSpentUsd: number | null;
    monthlyCapUsd: number;
    runCeilingUsd: number;
    learningSpentUsd: number | null;
    learningBudgetUsd: number;
  };
  testSets: Record<"debrief_open" | "debrief_gate" | "debrief_sealed", number>;
  liveTenants: Array<{ id: string; name: string }>;
}

export interface DebriefRunRow {
  id: string;
  scenarioSessionId: string;
  mode: DebriefRunMode;
  status: DebriefRunStatus;
  skipReason: string | null;
  recipeKey: string | null;
  releaseVersion: number | null;
  language: string | null;
  learnerTurns: number;
  hasRiskCue: boolean;
  learnerDistress: boolean;
  fallbackRung: number;
  revisionRounds: number;
  evaluatorOverall: number | null;
  judgeOverall: number | null;
  costUsd: number | null;
  seconds: number | null;
  checkFailureCount: number;
  experimentId: string | null;
  arm: "baseline" | "challenger" | null;
  createdAt: string;
  tenantName: string | null;
}

export interface DebriefRunStep {
  step: string;
  label: string;
  status: "done" | "failed" | "skipped";
  startedAt: string;
  ms: number;
  model?: string | null;
  estimatedUsd?: number;
  round?: number;
  note?: string | null;
}

export interface DebriefRunDetail {
  id: string;
  scenarioSessionId: string;
  mode: DebriefRunMode;
  status: DebriefRunStatus;
  skipReason: string | null;
  recipeKey: string | null;
  releaseVersion: number | null;
  language: string | null;
  fallbackRung: number;
  revisionRounds: number;
  estimatedCostUsd: string;
  actualCostUsd: string | null;
  ceilingUsd: string | null;
  evaluatorOverall: string | null;
  evaluatorHardFails: Array<{ code: string; evidence: string }>;
  checkFailures: Array<{ code: string; section: string; detail: string }>;
  steps: DebriefRunStep[];
  workspace: {
    judge?: { overall: number | null; hardFails: Array<{ code: string; evidence: string }> };
    evaluations?: Array<{
      round: number;
      overall: number | null;
      hardFails: string[];
      checks: string[];
    }>;
    [k: string]: unknown;
  };
  cards: DebriefCardsData | null;
  error: string | null;
}

export interface DebriefCardsData {
  opening: string;
  important_moment?: {
    turn_index: number;
    quote: string;
    handled_well: boolean;
    lead: string;
    body: string;
  } | null;
  what_worked: Array<{
    skill: string;
    turn_index: number;
    quote: string;
    lead: string;
    body: string;
  }>;
  work_on_this: Array<{
    skill: string;
    turn_index: number;
    quote: string;
    lead: string;
    why: string;
    try_saying: string;
  }>;
  practise_next?: { skill: string; reason: string } | null;
  reflective_question: string;
  progress_note?: string | null;
}

export type ImproverIdeaKind = "prompt_edit" | "setting" | "needs_code" | "defect" | "needs_person";

export type ImproverScreen =
  | { status: "running"; startedAt: string }
  | { status: "failed"; startedAt: string; error?: string }
  | ImproverScreenResult;

export interface ImproverScreenResult {
  status: "done";
  cases: number;
  pairs: number;
  baselineFailures: number;
  challengerFailures: number;
  baselineMean: number | null;
  challengerMean: number | null;
  lift: number | null;
  baselineHardFails: number;
  challengerHardFails: number;
  challengerCheckFailures: number;
  costUsd: number;
  passed: boolean;
  ranAt: string;
}

export interface ImproverIdeaRow {
  id: string;
  status: "proposed" | "quarantined" | "approved" | "active" | "blocked" | "rejected" | "retired";
  title: string;
  change: {
    ideaKind: ImproverIdeaKind;
    promptCode: string | null;
    find: string | null;
    replace: string | null;
    settingKey: string | null;
    settingValue: string | null;
  };
  evidence: {
    hypothesis?: string;
    evidence?: string;
    expectedEffect?: string;
    screen?: ImproverScreen;
  };
  createdAt: string;
  releaseVersion: number | null;
  releaseStatus: string | null;
}

export interface ImproverState {
  report: string | null;
  at: string | null;
  learningSpentUsd: number | null;
  ideas: ImproverIdeaRow[];
}

export interface DebriefReleaseRow {
  id: string;
  version: number;
  status: string;
  authorKind: string;
  notes: string | null;
  createdAt: string;
  promotedAt: string | null;
  prompts: Record<string, number | null>;
  maxRevisionRounds: number | null;
}

export interface DebriefTenantRow {
  id: string;
  name: string;
  live: boolean;
  isTest: boolean;
}
