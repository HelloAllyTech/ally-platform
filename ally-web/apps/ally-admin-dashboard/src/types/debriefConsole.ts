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
  /** Organisations where over 5% of today's debriefs guessed the language (v9 FR-40). */
  languageIncidents?: Array<{
    tenantId: string;
    tenantName: string | null;
    runs: number;
    detected: number;
    unsure: number;
  }>;
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
  /** Reasoning out loud (v9 FR-38). Absent on runs made before they were recorded. */
  why?: string | null;
  inputs?: string[];
  reasoning?: string | null;
  output?: string | null;
  budgetLeftUsd?: number;
}

/** One Ask Ally reply: how it was reached. Never the learner's message. */
export interface DebriefReplyTrace {
  at: string;
  model: string;
  turns: number;
  costUsd: number;
  tools: Array<{ name: string; topic?: string; ok: boolean; ms: number; found: string }>;
  stoppedBy?: "max_turns" | "budget";
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
    decision?: { status: DebriefRunStatus; round: number | null; why: string };
    drafts?: Array<{
      round: number;
      cards: DebriefCardsData;
      critique: Array<{ section: string; note: string }>;
    }>;
    replyTraces?: DebriefReplyTrace[];
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
    others?: Array<{ turn_index: number; quote: string; note: string }>;
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

export type PmAgentIdeaKind = "prompt_edit" | "setting" | "needs_code" | "defect" | "needs_person";

export type PmAgentScreen =
  | { status: "running"; startedAt: string }
  | { status: "failed"; startedAt: string; error?: string }
  | PmAgentScreenResult;

export interface PmAgentScreenResult {
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

export interface PmAgentIdeaRow {
  id: string;
  status: "proposed" | "quarantined" | "approved" | "active" | "blocked" | "rejected" | "retired";
  title: string;
  change: {
    ideaKind: PmAgentIdeaKind;
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
    screen?: PmAgentScreen;
    /** Rung 2, the full gate test. */
    gate?:
      | { status: "running" | "failed"; startedAt: string; error?: string }
      | (PmAgentLadderResult & {
          rules: { hardFails: boolean; median: boolean; cost: boolean; scored: boolean };
        });
    /** Rung 3, paired trials on real sessions. */
    trial?: {
      status: "running" | "passed" | "failed";
      startedAt: string;
      comparisons: number;
      meanDifference?: number | null;
      lower?: number | null;
      upper?: number | null;
    };
    /** Rung 4, the canary to real learners. */
    canary?: {
      status: "running" | "passed" | "reverted" | "promoted";
      releaseId: string;
      version: number;
      share: number;
      startedAt: string;
      canaryRuns?: number;
      canaryMedian?: number | null;
      controlMedian?: number | null;
      reason?: string;
    };
  };
  createdAt: string;
  releaseVersion: number | null;
  releaseStatus: string | null;
}

export interface PmAgentState {
  report: string | null;
  at: string | null;
  learningSpentUsd: number | null;
  ideas: PmAgentIdeaRow[];
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
  /** v9 FR-25: outside India there is no default support line. */
  region: "india" | "outside_india";
  /** The organisation set support lines of its own in its Ally guide settings. */
  hasSupportContact: boolean;
  /** v9 FR-8: this calendar month's debrief spend (shadow and live), and how many runs. */
  monthSpentUsd?: number;
  monthRuns?: number;
}

export interface DebriefReviewRun {
  id: string;
  scenarioSessionId: string;
  status: DebriefRunStatus;
  skipReason: string | null;
  language: string | null;
  hasRiskCue: boolean;
  learnerDistress: boolean;
  evaluatorOverall: string | null;
  judgeOverall: number | null;
  checkFailures: Array<{ code: string; section: string; detail: string }>;
  evaluatorHardFails: Array<{ code: string; evidence: string }>;
  createdAt: string;
  tenantName: string | null;
  escalation: { by: number; at: string; note: string | null } | null;
  /** v9 FR-21: published, but the independent judge scored it below the bar or found a hard fail. */
  judgeBelowBar: boolean;
  judgeHardFails: Array<{ code: string; evidence: string }> | null;
}

/** The words of a card a reviewer may rewrite; the quote never changes. */
export type DebriefCardCorrection = Partial<
  Record<"lead" | "body" | "why" | "try_saying" | "reason", string>
>;

export interface DebriefReviewFlag {
  id: string;
  runId: string;
  scenarioSessionId: string;
  section: string;
  reason: "didnt_say" | "described_wrongly" | "advice_doesnt_fit" | "something_else";
  note: string | null;
  urgent: boolean;
  status: "open" | "escalated";
  createdAt: string;
  language: string | null;
  tenantName: string | null;
  cardText: string | null;
  card: DebriefCardCorrection | null;
}

export interface DebriefReviewQueue {
  runs: DebriefReviewRun[];
  flags: DebriefReviewFlag[];
}

/** A model a person may pick for a debrief step or for Ask Ally. */
export interface DebriefModelChoice {
  model: string;
  label: string;
  provider: string | null;
}

/** Each step's model in the live release, and what may replace it. */
export interface DebriefModels {
  releaseVersion: number | null;
  steps: Array<{ step: string; model: string | null; backupModel: string | null }>;
  reply: string;
  judge: string;
  choices: { steps: DebriefModelChoice[]; reply: DebriefModelChoice[] };
}

/** v9 FR-38 "Registry": one recipe step as a capability, with 30 days of production use. */
export interface DebriefStepUsage {
  step: string;
  model: string | null;
  backupModel: string | null;
  inRecipes: string[];
  done: number;
  failed: number;
  skipped: number;
  medianMs: number | null;
  estimatedUsd: number;
  models: string[];
}

export interface PmAgentLadderResult {
  status: "done";
  cases: number;
  pairs: number;
  baselineMedian: number | null;
  challengerMedian: number | null;
  baselineHardFails: number;
  challengerHardFails: number;
  baselineCostUsd: number;
  challengerCostUsd: number;
  passed: boolean;
}

/** v9 FR-60: one owner setting's spec, as ally-be sends it. */
export interface DebriefOwnerSettingSpec {
  default: number | boolean;
  kind: "int" | "number" | "share" | "bool";
  min?: number;
  max?: number;
  budget?: boolean;
  group: "quick" | "gate" | "sealed" | "trials" | "canary" | "budget" | "metrics";
}

export interface DebriefSettingsView {
  values: Record<string, number | boolean>;
  defaults: Record<string, number | boolean>;
  spec: Record<string, DebriefOwnerSettingSpec>;
  changed: string[];
  baseline: {
    ranAt: string;
    facts: {
      runsPerDay?: number;
      liveRunsPerDay?: number;
      eligibleSessionsPerMonth?: number;
      judge?: { scored: number; median: number | null; sd: number | null };
      rejudge?: { pairs: number; sdOfDifference: number | null };
      hardFailRate?: number | null;
      costPerRunUsd?: { p50: number | null; p90: number | null };
    };
    proposals: Record<string, { value: number | boolean; reason: string; misfit: boolean }>;
  } | null;
  updatedAt: string;
  updatedBy: number | null;
}

/** A rate with its counts (v9 §3.3); `value` is null when nothing was counted. */
export interface DebriefRate {
  value: number | null;
  n: number;
  of: number;
  /** 95% Wilson interval; absent on rates summed in the browser. */
  low?: number | null;
  high?: number | null;
}

/** The Console's metric filters: one set, applied to every live metric (and later the eval surface). */
export interface DebriefMetricsFilter {
  tenantId?: string;
  language?: string;
  learnerLevel?: string;
  recipe?: string;
  releaseVersion?: number;
  judgeVersion?: string;
}

export interface DebriefFilterOptions {
  organisations: Array<{ id: string; name: string }>;
  languages: string[];
  learnerLevels: string[];
  recipes: string[];
  releaseVersions: number[];
  judgeVersions: string[];
}

export type DebriefPassBreakdownRow = { key: string; debriefs: number } & DebriefPassGroup;

/** The pass rate and its companions for one group of live debriefs (same definition as the eval). */
export interface DebriefPassGroup {
  passRate: DebriefRate;
  outages: number;
  unjudged: number;
  hardFailRate: DebriefRate;
  judgeMean: number | null;
}

export interface DebriefExperienceRates {
  openedWithin24h: DebriefRate;
  readThrough: DebriefRate;
  practiseClickThrough: DebriefRate;
  reflectionAnswered: DebriefRate;
  abandonedBeforeReady: DebriefRate;
  flagsWithinSla: DebriefRate;
  listened: DebriefRate;
  replied: DebriefRate;
}

export interface DebriefMetricsWeek {
  week: string;
  debriefs: number;
  steering: {
    value: number | null;
    missing: Array<"practise" | "thumbs">;
    components: { judge: number | null; practise: DebriefRate; thumbs: DebriefRate };
  };
  guardrails: {
    judgeP50: number | null;
    judgeMean: number | null;
    judged: number;
    hardFailRate: DebriefRate;
    fabricatedQuotes: number;
    thumbsDownRate: DebriefRate;
    visibleSecondsP50: number | null;
    visibleSecondsP90: number | null;
    costP50: number | null;
    costP90: number | null;
    evaluatorJudgeGap: number | null;
  };
  efficiency: {
    savedUsdMean: number | null;
    revisionRoundsP50: number | null;
    stepsP50: number | null;
    within10Min: DebriefRate;
  };
  experience: DebriefExperienceRates;
}

export interface DebriefMetricsView {
  weeks: number;
  weights: { judge: number; practise: number; thumbs: number };
  flagReviewSlaHours: number;
  series: DebriefMetricsWeek[];
  byLanguage: Array<{ key: string; debriefs: number; experience: DebriefExperienceRates }>;
  byPlatform: Array<{ key: string; debriefs: number; experience: DebriefExperienceRates }>;
  baselines: {
    from: string;
    until: string;
    legacyHardFailRate: DebriefRate;
    legacyThumbsDownRate: DebriefRate;
  };
  uptake: Array<{
    month: string;
    pairs: number;
    lift: number | null;
    lower: number | null;
    upper: number | null;
    insufficient: boolean;
  }>;
  safetyRecall: { recorded: false };
  quality?: {
    byWeek: Array<{ week: string } & DebriefPassGroup>;
    byLanguage: Array<{ language: string; debriefs: number } & DebriefPassGroup>;
    bySegment: Array<
      {
        language: string;
        writerModel: string;
        judgeVersion: string;
        debriefs: number;
      } & DebriefPassGroup
    >;
    breakdowns?: {
      skill: DebriefPassBreakdownRow[];
      scenario: DebriefPassBreakdownRow[];
      course: DebriefPassBreakdownRow[];
      sessionLength: DebriefPassBreakdownRow[];
      stepModel: DebriefPassBreakdownRow[];
      risk: DebriefPassBreakdownRow[];
    };
  };
  agents?: DebriefAgentMetrics;
  filter?: DebriefMetricsFilter;
  /** Sections read across all organisations and versions whatever the filter says. */
  unfiltered?: string[];
  filterOptions?: DebriefFilterOptions;
  generatedAt: string;
}

export interface DebriefStepHealth {
  ran: number;
  failRate: DebriefRate;
  retryRate: DebriefRate;
  msP50: number | null;
  msP90: number | null;
}

export interface DebriefAgreement {
  n: number;
  both: number;
  referenceOnly: number;
  candidateOnly: number;
  neither: number;
  kappa: number | null;
  recall: DebriefRate;
  falseFlagRate: DebriefRate;
}

/** Live numbers per agent in the debrief family (ally-be debrief-stage-metrics.util). */
export interface DebriefAgentMetrics {
  stages: {
    runs: number;
    safetyReader: DebriefStepHealth & {
      riskCueRate: DebriefRate;
      judgeMissDespiteCoverage: DebriefRate;
    };
    analyst: DebriefStepHealth;
    progressReader: DebriefStepHealth & { unsupportedProgressRate: DebriefRate };
    guidanceLookup: {
      ran: number;
      foundRate: DebriefRate;
      passagesPerRunMean: number | null;
      clinicalOnNoRiskRate: DebriefRate;
      wrongLevelRate: DebriefRate;
    };
    writer: DebriefStepHealth & {
      firstDraftPassRate: DebriefRate;
      firstDraftFailures: Array<{ code: string; runs: number }>;
    };
    reviser: DebriefStepHealth & {
      fixRate: DebriefRate;
      regressionRate: DebriefRate;
      deadlineSkipRate: DebriefRate;
    };
    evaluator: DebriefStepHealth & {
      missedRiskCue: DebriefAgreement;
      heldOnItsOwnRate: DebriefRate;
    };
    judge: { judgedRate: DebriefRate; versions: string[] };
  };
  askAlly: {
    replies: number;
    questions: number;
    checkPassRate: DebriefRate;
    passRate: DebriefRate | null;
    distressFlags: number;
    modelCalls: number;
  };
  pmAgent: {
    ideas: number;
    screened: number;
    gated: number;
    promoted: number;
    reverted: number;
    rejected: number;
    pending: number;
    holdRate: DebriefRate;
  };
}
