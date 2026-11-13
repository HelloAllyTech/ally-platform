import type { BuilderDecisionOption } from "./builder";
import type { DebriefViewer } from "./debriefConsoleView";

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
  /** Guidance lookup: the Debrief Guidance entries it kept, by code (`DG-…`, PRD §14). */
  citations?: Array<{ code: string; title: string }>;
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
  /** "Hand to Builder": who answers Builder's interview questions (R2-20). */
  answerer?: PmAgentBuilderAnswerer;
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
  | {
      /** Route D: a Debrief Guidance entry drafted for the clinical advisor; never written by the agent. */
      kind: "guidance";
      action: "new" | "change";
      scope: "organisation" | "platform";
      existingCode?: string;
      existingTitle?: string;
      title: string;
      situation: string;
      guidance: string;
      why: string;
      runIds: string[];
      learners: number;
      tenants: number;
      for: string;
    }
);

/** Who answers Builder's interview for an idea handed to Builder. */
export type PmAgentBuilderAnswerer = "pm_agent" | "person";

/** In Builder: interviewing · building · PR open · merged · closed (from the session's real status). */
export type PmAgentBuilderStage = "interviewing" | "building" | "pr_open" | "merged" | "closed";

/** One answer the PM agent sent Builder (its own words; never learner quotes). */
export interface PmAgentBuilderAnswer {
  questionId: string;
  question: string;
  answer: string;
  at: string;
}

/** `GET …/pm-agent/ideas/:id/builder`: where an idea handed to Builder stands. */
export interface PmAgentBuilderProgress {
  sessionId: string;
  answerer: PmAgentBuilderAnswerer;
  stage: PmAgentBuilderStage;
  sessionStatus: string | null;
  waiting:
    | {
        kind: "question";
        questionId: string;
        prompt: string;
        /** Builder's own options, as its feed shows them. */
        options: BuilderDecisionOption[];
        /** One option, or several (at least `minSelections`). Absent from an older ally-be. */
        selection?: "single" | "multi";
        minSelections?: number | null;
        allowCustom?: boolean;
        customPlaceholder?: string | null;
        /** Why the PM agent left it for a person; null when the person answers everything. */
        reason: string | null;
      }
    | { kind: "brief" }
    | { kind: "pm_agent" }
    | null;
  answers: PmAgentBuilderAnswer[];
  pullRequests: {
    repo: string;
    number: number;
    url: string;
    state: string | null;
    merged: boolean;
  }[];
}

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
    /** A pinned rule's first version: the text in force, never approved; no find/replace. */
    firstVersion?: boolean;
    /** The version a first-version item asks to approve. */
    version?: number;
  };
  evidence: {
    hypothesis?: string;
    /** A pinned-rule proposal: who proposed it and why. */
    proposedBy?: number;
    why?: string;
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
          rules: {
            hardFails: boolean;
            median: boolean;
            cost: boolean;
            scored: boolean;
            /** Plan §9: the seeded safety set at 100% on all three repetitions (absent on older gates). */
            safetyRecall?: boolean;
          };
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
      /** `skipped`: not learner-visible, promoted after its paired trial (spec §4). */
      status: "running" | "passed" | "reverted" | "promoted" | "skipped";
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
  /** The short code people call it by, when ally-be sends one. */
  code?: string | null;
  /** Console redesign item 7 (CONSOLE_API.md "PM agent: approvals"). */
  decidedBy?: number | null;
  decidedAt?: string | null;
  changeKind?: "settings" | "prompts" | "pinned_rules" | null;
  /** Open = needs a person, being tested or in canary; closed = everything else. */
  state?: "open" | "closed";
  closedReason?:
    | "promoted"
    | "rejected"
    | "expired"
    | "reverted"
    | "did_not_pass"
    | "handed_off"
    | "answered"
    | "signed_off"
    | "withdrawn"
    | "retired"
    | null;
  closedWhy?: string | null;
  /** The release a promoted idea became (`release-history/:id`). */
  releaseId?: string | null;
  draftRelease?: {
    id: string;
    version: number;
    status: string;
    changedVsLive: DebriefBundleDiff;
    compare: { releaseId: string };
  } | null;
  approval?: {
    wait:
      | "pinned_rule"
      | "handoff"
      | "start_quick_test"
      | "promote_budget"
      | "start_gate"
      | "start_trial"
      | "start_canary"
      | "promote";
    since: string;
    /** Null when it never expires (a pinned rule's first version). */
    expiresAt: string | null;
    expiresInDays: number | null;
    expired: boolean;
    expiringSoon: boolean;
  } | null;
  expired?: boolean;
  notTakenForward?: boolean;
  notTakenForwardReason?: "no_decision" | "rejected" | null;
  questions?: Array<{
    id: string;
    role: "person" | "agent";
    by: number | string | null;
    at: string;
    text: string;
    replyTo?: string;
  }>;
  can?: {
    approve: boolean;
    reject: boolean;
    tryIt: boolean;
    askQuestion: boolean;
    startStep: boolean;
    editDraft?: boolean;
    /** Pinned rules: withdraw one's own proposal. */
    withdraw?: boolean;
    /** Pinned rules: propose a change from this item. */
    askForChange?: boolean;
  };
  /** Pinned-rule items only: the rule as it would read, and what else is open on it. */
  pinnedRule?: PmAgentPinnedRule;
}

/** One run of a pinned rule's text; `changed` is the proposed wording. */
export interface PinnedRuleSegment {
  text: string;
  changed: boolean;
}

export interface PmAgentPinnedRule {
  /** "Safety rules", "Rubric", "Judge's instructions". */
  name: string;
  firstVersion: boolean;
  /** The viewer proposed it. */
  mine: boolean;
  proposedBy: number | null;
  liveVersion: number | null;
  /** The text in force, which a further change is written against (open items only). */
  liveText: string | null;
  /** The whole rule as it would read after the change (open items only). */
  segments: PinnedRuleSegment[] | null;
  /** The passage is no longer in the rule: it changed since. */
  stale: boolean;
  /** Other open proposals on the same rule. */
  otherOpen: number;
  approvedNote: string | null;
}

export interface PmAgentState {
  report: string | null;
  at: string | null;
  learningSpentUsd: number | null;
  ideas: PmAgentIdeaRow[];
  viewer?: DebriefViewer;
  counts?: { open: number; closed: number };
}

/** What a release changes against another (CONSOLE_API.md `BundleDiff`). */
export interface DebriefBundleDiff {
  prompts: Array<{ code: string; before: number | null; after: number | null; pinned: boolean }>;
  settings: Array<{ key: string; before: unknown; after: unknown }>;
  recipes: unknown[];
  steps: Array<{
    step: string;
    field: "enabled" | "model" | "backupModel";
    before: unknown;
    after: unknown;
  }>;
  reply: unknown;
  orchestrator: unknown;
  budgetOnly: boolean;
}

export interface DebriefTenantRow {
  id: string;
  name: string;
  live: boolean;
  /** FR-46: switched off after being on — its learners read "not available". */
  stopped?: boolean;
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
  /** Plan §8.9 (FR-57): the approved providers its debriefs may use; all when absent. */
  providers?: string[];
}

/** The words of a card a reviewer may rewrite; the quote never changes. */
export type DebriefCardCorrection = Partial<
  Record<"lead" | "body" | "why" | "try_saying" | "reason", string>
>;

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

export interface DebriefSafetyRecallRun {
  ideaId: string;
  /** The idea whose challenger was gated. */
  challenger: string;
  kind: string | null;
  releaseId: string | null;
  releaseVersion: number | null;
  ranAt: string | null;
  passed: boolean;
  reps: Array<{ rep: number; recall: number; missed: number }>;
  cases: number | null;
  planted: number | null;
  model: string | null;
  error: string | null;
}
export type DebriefSafetyRecallMetric =
  | { recorded: false }
  | { recorded: true; latest: DebriefSafetyRecallRun; history: DebriefSafetyRecallRun[] };

export interface DebriefExperienceRates {
  openedWithin24h: DebriefRate;
  readThrough: DebriefRate;
  practiseClickThrough: DebriefRate;
  reflectionAnswered: DebriefRate;
  abandonedBeforeReady: DebriefRate;
  flagsWithinSla: DebriefRate;
  listened: DebriefRate;
  replied: DebriefRate;
  /** PRD §9 pulse (absent from servers before it). */
  pulseKnewNext?: DebriefRate;
  pulseFair?: DebriefRate;
  pulseFairImportantMoment?: DebriefRate;
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
  /** Plan §9: the PM agent's gate runs the seeded safety set × 3 on each challenger. */
  safetyRecall: DebriefSafetyRecallMetric;
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

/** PM agent › Reports (CONSOLE_API.md, `GET pm-agent/reports`). */
export type PmReportKind = "weekly" | "monthly";

export interface PmReportListItem {
  kind: PmReportKind;
  /** `YYYY-MM` for a month, the Monday `YYYY-MM-DD` for a week (India time). */
  period: string;
  title: string;
  publishedAt: string | null;
  hasReview: boolean;
}

type PmReportPerson = { id: number; name: string | null } | null;

export type PmReportStanding =
  | { status: "standing" }
  | { status: "reverted"; at: string }
  | { status: "not_yet" };

export interface PmReportChanged {
  from: string;
  to: string;
  liveForEveryone: {
    count: number;
    byPerson: number;
    items: Array<{
      releaseId: string;
      version: number;
      ideaId: string | null;
      title: string;
      at: string;
      approvedBy: PmReportPerson;
      standing: PmReportStanding;
    }>;
  };
  reverted: {
    count: number;
    items: Array<{
      releaseId: string | null;
      version: number | null;
      ideaId: string | null;
      title: string;
      at: string;
      how: "try_out_reverted" | "try_out_stopped" | "rolled_back" | "emergency";
      by: PmReportPerson;
      reason: string | null;
    }>;
  };
  rejected: {
    count: number;
    items: Array<{
      ideaId: string;
      title: string;
      at: string;
      withdrawn: boolean;
      by: PmReportPerson;
      reason: string | null;
    }>;
  };
  tests: { count: number; passed: number; quickChecks: number; passTests: number; trials: number };
  sentToBuilder: { count: number };
  budget: {
    spentUsd: number;
    capUsd: number;
    parts: { testsUsd: number; pmAgentUsd: number };
  } | null;
}

/** `GET pm-agent/reports/:kind/:period`. */
export interface PmReport {
  kind: PmReportKind;
  period: string;
  title: string;
  changed: PmReportChanged;
  review: { text: string; publishedAt: string } | null;
}
