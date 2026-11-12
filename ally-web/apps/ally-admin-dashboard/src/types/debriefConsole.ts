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
  /** The scenario the roleplay ran (console redesign item 6); absent from an older backend. */
  scenarioName?: string | null;
  tenantId?: string | null;
  /** Queue order from ally-be (0 urgent flag, 1 other flag, 2 below the bar, 3 the rest). */
  queueRank?: number | null;
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
  /** The learner's question and the reply sent (console redesign item 5); absent until ally-be sends them. */
  question?: string | null;
  reply?: string | null;
  /** Whether the reply passed its checks or the fallback replaced it. */
  outcome?: "passed" | "replaced" | null;
  /** The card the question was about (a section such as `work_on_this[0]`). */
  section?: string | null;
  /** A replaced reply: the draft that was blocked and the check it failed. */
  blocked?: string | null;
  failedCheck?: string | null;
  /** Time to the reply's first words. */
  firstWordsMs?: number | null;
  /** Whether the safety check found distress in the question. */
  distress?: boolean | null;
}

/** One skill in the learner's running estimate (PRD §10): shown only in "How it was made". */
export interface DebriefSkillEstimate {
  skill: string;
  /** 0..1, or null when it did not come up. */
  level: number | null;
  word?: string | null;
}

/** Something the viewer's role must decide on this session (console redesign item 21). */
export interface DebriefPendingAction {
  kind: "urgent_flag" | "flag" | "distress" | "held" | "below_bar" | "escalated";
  role: "team" | "advisor";
  /** The flag's id for a flag, else the run's. */
  id: string;
  since: string;
  /** Turns to read first. */
  turns?: number[];
  /** The card section to read first, e.g. `work_on_this[0]`. */
  section?: string | null;
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
  /** Console redesign additions; each is absent from an older backend. */
  scenarioName?: string | null;
  tenantName?: string | null;
  createdAt?: string;
  hasRiskCue?: boolean;
  learnerDistress?: boolean;
  arm?: "baseline" | "challenger" | null;
  seconds?: number | null;
  skillEstimate?: { skills: DebriefSkillEstimate[]; sessions: number } | null;
  pendingActions?: DebriefPendingAction[];
  /** Whether the viewer may add comments (review rights). */
  canComment?: boolean;
  /** The version a correction saves as (1 for the debrief as first published). */
  cardVersion?: number | null;
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

/** By route (spec C3): A is route_a until drafted, then prompt_edit / setting / registry_agent; B, C, D. */
export type PmAgentIdeaKind =
  | "route_a"
  | "prompt_edit"
  | "setting"
  | "registry_agent"
  | "needs_code"
  | "defect"
  | "needs_person"
  /** A proposal to change a pinned rule: only the clinical advisor or the owner approves it. */
  | "pinned_rule";

/** What the PM agent wrote for a person to act on (routes B, C, D). Never learner quotes. */
export type PmAgentHandoff = {
  status: "waiting" | "filed" | "answered";
  filedId?: string | null;
} & (
  | {
      kind: "builder";
      problem: string;
      evidenceSummary: string;
      expectedEffect: string;
      acceptanceChecks: string[];
    }
  | { kind: "bug_hunter"; summary: string; runIds: string[]; repo: string | null }
  | { kind: "person"; topic: string; question: string; context: string; for: string }
);

/** Closing the loop (spec C5): the metric the idea named, before and after it went live. */
export interface PmAgentForecast {
  metric: string;
  direction: "up" | "down";
  baseline: number | null;
  after?: number | null;
  moved?: boolean | null;
  checkedAt?: string;
}

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
    route?: "A" | "B" | "C" | "D";
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
    commentIds?: string[];
    handoff?: PmAgentHandoff;
    forecast?: PmAgentForecast;
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
  /** Console redesign item 7: the short code people call it by, and when it lapses as "no decision". */
  code?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
  questions?: Array<{
    id: string;
    by: string | null;
    body: string;
    at: string;
    reply?: string | null;
  }>;
}

/** How free the PM agent is with one kind of change (PRD §12). */
export interface PmAgentAutonomy {
  kind: "settings" | "guidance" | "prompts" | "models" | "pinned_rules";
  state: "alone" | "asks_first" | "always_asks" | "never";
  reason: string | null;
}

export interface PmAgentState {
  report: string | null;
  at: string | null;
  learningSpentUsd: number | null;
  ideas: PmAgentIdeaRow[];
  /** Console redesign item 8; absent from an older backend. */
  autonomy?: PmAgentAutonomy[];
}

/** A pinned rule's live version and who signed it (console redesign item 9). */
export interface DebriefPinnedRule {
  key: string;
  name: string;
  version: number;
  signedBy: string | null;
  signedRole?: "clinical_advisor" | "owner" | null;
  signedAt: string | null;
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
  /** The support line learners are shown, in words (console redesign item 12). */
  supportLine?: string | null;
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
  scenarioName?: string | null;
  queueRank?: number | null;
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
  scenarioName?: string | null;
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
  /** Console redesign "Steps and models": share of runs that used it, paired-trial win rate, on/off. */
  usedShare?: number | null;
  winRate?: number | null;
  enabled?: boolean | null;
  fixed?: boolean | null;
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
  group: "quick" | "gate" | "sealed" | "trials" | "canary" | "budget" | "metrics" | "agent";
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
  /** Console redesign items 8, 9, 13; absent from an older backend. */
  autonomy?: PmAgentAutonomy[];
  pinnedRules?: DebriefPinnedRule[];
  /** "What the PM agent may do alone": kind of change × test step (design update 2026-11-12). */
  autonomyMatrix?: PmAgentAutonomyRow[];
  /** Per organisation: may only tighten the defaults above. */
  orgAutonomy?: DebriefOrgAutonomy[];
}

export type PmAgentAutonomyStep = "quick" | "gate" | "trial" | "canary";
export type PmAgentAutonomyCell = "alone" | "asks_first" | "off" | "never";

export interface PmAgentAutonomyRow {
  kind: PmAgentAutonomy["kind"];
  steps: Record<PmAgentAutonomyStep, PmAgentAutonomyCell>;
  eligible: boolean;
  eligibleReason: string | null;
}

export type DebriefOrgPolicy = "default" | "asks_first" | "never";

export interface DebriefOrgAutonomy {
  tenantId: string;
  tenantName: string;
  live: boolean;
  trials: DebriefOrgPolicy;
  canaries: DebriefOrgPolicy;
  guidance: DebriefOrgPolicy;
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

/** Filters that narrow only the pass rate; they sit under its heading (they were its breakdowns). */
export interface DebriefPassRateSegment {
  skill?: string;
  scenarioId?: number;
  courseId?: number;
  sessionLength?: string;
  /** "<step>: <model>". */
  stepModel?: string;
  risk?: "risk" | "no_risk";
}

export interface DebriefFilterOptions {
  organisations: Array<{ id: string; name: string }>;
  languages: string[];
  learnerLevels: string[];
  recipes: string[];
  releaseVersions: number[];
  judgeVersions: string[];
  /** The pass-rate segments' values in the window (absent from an older backend). */
  skills?: string[];
  scenarios?: Array<{ id: number; name: string }>;
  courses?: Array<{ id: number; name: string }>;
  sessionLengths?: string[];
  stepModels?: string[];
  risks?: Array<"risk" | "no_risk">;
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
  /** The pass rate without the segment filters; sent only when one is set (the headline tiles read it). */
  qualityAll?: DebriefMetricsView["quality"];
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

type CodeCount = Array<{ code: string; runs: number }>;

/** One registry agent's live numbers (ally-be `RegistryAgentMetrics`). */
export interface DebriefRegistryAgentMetrics extends DebriefStepHealth {
  agent: string;
  floor: boolean;
  offered: number;
  chosenRate: DebriefRate;
  findingsPerRunMean: number | null;
  droppedQuoteRate: DebriefRate;
  usedByWriterRate: DebriefRate;
  judgedHardFailRate: DebriefRate;
  topHardFails: CodeCount;
}

/** The planner, the top-up and every registry agent (ally-be `OrchestratorMetrics`). */
export interface DebriefOrchestratorMetrics {
  runs: number;
  planner: DebriefStepHealth & {
    fallbackRate: DebriefRate;
    timeoutRate: DebriefRate;
    fallbackReasons: CodeCount;
    agentsChosenMean: number | null;
    agentsChosenP50: number | null;
    droppedForBudgetRate: DebriefRate;
    droppedForTimeRate: DebriefRate;
    droppedUnavailableRate: DebriefRate;
    chosen: CodeCount;
  };
  topUp: { reachedRate: DebriefRate; addedRate: DebriefRate; passAfterTopUpRate: DebriefRate };
  skippedThenMissed: {
    overall: DebriefRate;
    byAgent: Array<{ agent: string; whenSkipped: DebriefRate; whenChosen: DebriefRate }>;
  };
  agents: DebriefRegistryAgentMetrics[];
  protocolCheck: {
    contradictsProtocolRate: DebriefRate;
    contradictsProtocolWithoutRate: DebriefRate;
    appliedRate: DebriefRate;
    protocolNamedRate: DebriefRate;
  };
  languageSpecialist: { sessions: number; missWithRate: DebriefRate; missWithoutRate: DebriefRate };
  historyDeep: {
    unsupportedProgressWithRate: DebriefRate;
    unsupportedProgressWithoutRate: DebriefRate;
  };
  aggregates: Array<{
    agent: string;
    ran: number;
    noQuoteRate: DebriefRate;
    smallGroupRefusedRate: DebriefRate;
  }>;
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
    /** Absent from an ally-be older than the orchestrator metrics. */
    orchestrator?: DebriefOrchestratorMetrics;
  };
  askAlly: {
    replies: number;
    questions: number;
    checkPassRate: DebriefRate;
    passRate: DebriefRate | null;
    distressFlags: number;
    modelCalls: number;
    /** Ask Ally model spend over the window, and over the replies sent (PRD: at most $0.05). Absent from an older backend. */
    spendUsd?: number;
    costPerReplyMean?: number | null;
    costPerReplyTarget?: number;
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
