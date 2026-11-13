/**
 * The redesigned Debriefs console's payloads — mirrors docs/debrief-harness/CONSOLE_API.md
 * (ally-be `debrief-console-view.service.ts`, `debrief-autonomy.service.ts`).
 */
import {
  DebriefCardCorrection,
  DebriefCardsData,
  DebriefRunMode,
  DebriefRunStatus,
  DebriefRunStep,
} from "./debriefConsole";
import {
  AgreementMeasure,
  AgreementQuestion,
  ExpertComment,
  ExpertTranscriptTurn,
  ExpertVerdict,
} from "./debriefExpertReview";

export type DebriefCanAction =
  | "comment"
  | "flagDecision"
  | "heldDebrief"
  | "escalate"
  | "verdict"
  | "pmAgent"
  | "approvePinnedRule"
  | "testSets"
  | "releases"
  | "switchOrgOn"
  | "emergencyStop"
  | "agentLogs"
  | "ownerSettings";

export interface DebriefViewer {
  roles: {
    allyTeam: boolean;
    clinicalAdvisor: boolean;
    owner: boolean;
    receivesEscalations: boolean;
  };
  can: Record<DebriefCanAction, boolean>;
}

export type DebriefHomeCategoryParam =
  | "needs"
  | "flagged"
  | "below"
  | "published"
  | "escalated"
  | "agreement_sample"
  | "all";

export interface DebriefSessionsQuery {
  category?: DebriefHomeCategoryParam;
  tenantId?: string;
  language?: string;
  recipe?: string;
  fallback?: "none" | "light" | "heavy";
  riskCue?: "true" | "false";
  cost?: "over_0_20" | "hit_ceiling";
  mode?: "production" | "live" | "shadow" | "replay" | "any";
  limit?: number;
  offset?: number;
}

export interface DebriefSessionListItem {
  runId: string;
  sessionId: string;
  scenario: { id: string | null; title: string | null };
  tenantId: string | null;
  tenantName: string | null;
  language: string | null;
  recipe: string | null;
  mode: DebriefRunMode;
  status: DebriefRunStatus;
  skipReason: string | null;
  releaseVersion: number | null;
  judgeOverall: number | null;
  evaluatorOverall: number | null;
  costUsd: number | null;
  ceilingUsd: number | null;
  seconds: number | null;
  fallbackRung: number | null;
  createdAt: string;
  rank: 0 | 1 | 2 | 3;
  needsPerson: boolean;
  urgent: boolean;
  flagged: boolean;
  flagCount: number;
  importantMomentFlagged: boolean;
  escalated: boolean;
  riskCue: boolean;
  learnerDistress: boolean;
  belowBar: boolean;
  reviewed: boolean;
  /** In the weekly agreement sample, waiting for a verdict. */
  agreementSample?: boolean;
  waitingSince: string | null;
}

export interface DebriefSessionsPage {
  category: string;
  counts: {
    needs: number;
    urgent: number;
    flagged: number;
    /** Null for a viewer blind to the checks until their verdict (the clinical advisor). */
    below: number | null;
    published: number;
    escalated: number;
    /** Only for whoever gives verdicts. */
    agreementSample?: number | null;
    all: number;
  };
  items: DebriefSessionListItem[];
  filterOptions: {
    tenants: Array<{ id: string; name: string }>;
    languages: string[];
    recipes: string[];
  };
  viewer: DebriefViewer;
}

export interface DebriefSessionFlag {
  id: string;
  section: string;
  reason: "didnt_say" | "described_wrongly" | "advice_doesnt_fit" | "something_else" | string;
  note: string | null;
  urgent: boolean;
  status: string;
  createdAt: string;
  inUndoWindow: boolean;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: { id: number; name: string | null } | null;
  cardText: string | null;
  card: DebriefCardCorrection | null;
  turns: number[];
  canDecide: boolean;
}

export type DebriefPendingKind =
  | "urgent_flag"
  | "learner_distress"
  | "flag"
  | "held"
  | "below_bar"
  | "escalated_flag"
  | "escalated_run";

export type DebriefDecision =
  | "keep"
  | "correct"
  | "remove"
  | "escalate"
  | "publish"
  | "todays_debrief"
  | "looks_fine"
  | "checked"
  | "verdict";

export interface DebriefSessionPending {
  kind: DebriefPendingKind;
  level: "red" | "yellow";
  waitingSince: string;
  overdue: boolean;
  title: string;
  flagId?: string;
  anchors: {
    turns: number[];
    cardSection?: string | null;
    learnerNote?: string | null;
    judgeReasons?: boolean;
    askAlly?: boolean;
  };
  decisions: DebriefDecision[];
}

export interface DebriefAskAllyExchange {
  question: string;
  askedAt: string;
  reply: string | null;
  repliedAt: string | null;
  check: "passed" | "replaced" | "no_reply";
  replacedReply: { reply: string; fails: string[] } | null;
  costUsd: number | null;
  model: string | null;
  tools: Array<{ name?: string; topic?: string; found?: string }> | unknown[];
  /** The card asked about ("work_on_this[0]"), when the learner app sent it. */
  section: string | null;
  /** Time from the question to Ally's first words (null before this release). */
  firstWordsMs: number | null;
}

export interface DebriefJudgeReason {
  source: "judge" | "evaluator" | "check";
  code: string;
  text: string;
  turns: number[];
}

/** One piece of evidence the progress reading cites: a turn of this session or of an earlier run. */
export interface DebriefProgressEvidence {
  /** "this" (or this run's id) for this session; otherwise the earlier debrief run's id. */
  run_id?: string | null;
  runId?: string | null;
  turn_index?: number | null;
  turnIndex?: number | null;
}

export type DebriefProgressTrend =
  | "more_consistent"
  | "about_the_same"
  | "worth_another_look"
  | "too_early";

/** One skill in the progress reading (PROGRESS_CONTRACT §3), after the code's hold-backs. */
export interface DebriefProgressSkill {
  skill: string;
  trend: DebriefProgressTrend;
  why: string | null;
  evidence: DebriefProgressEvidence[];
  /** The Foundational Skills levels as a cross-check. */
  fhs: "agrees" | "disagrees" | "absent" | null;
  /** The sentence the learner read; blank when held back or not shown. */
  learnerLine: string | null;
  hiddenFromLearner: boolean;
}

export interface DebriefProgressFollowup {
  point: string;
  status: "done" | "partly" | "not_yet";
  evidence?: DebriefProgressEvidence[];
}

export interface DebriefProgressFocus {
  skill: string;
  why: string | null;
  learner_line?: string | null;
  learnerLine?: string | null;
  practise_next?: boolean;
  practiseNext?: boolean;
}

export type DebriefProgressVetoCode =
  | "too_few_sessions"
  | "contradicted_by_analyst"
  | "contradicted_by_fhs"
  | "version_straddle"
  | "corrected_evidence"
  | "other_skill";

export interface DebriefProgressVeto {
  skill: string;
  veto: DebriefProgressVetoCode | string;
  detail?: string | null;
}

/** The progress reading for one debrief run (`debrief_progress_results`), null when none ran. */
export interface DebriefSessionProgress {
  shownAs: "line" | "card" | null;
  /** Sessions the reading looked across, this one included. */
  sessions: number | null;
  skills: DebriefProgressSkill[];
  followups: DebriefProgressFollowup[];
  focus: DebriefProgressFocus | null;
  vetoes: DebriefProgressVeto[];
  windowSessionIds: string[];
  createdAt: string;
}

export interface DebriefSessionView {
  run: {
    id: string;
    sessionId: string;
    mode: DebriefRunMode;
    status: DebriefRunStatus;
    skipReason: string | null;
    language: string | null;
    languageSource: string | null;
    recipe: string | null;
    releaseVersion: number | null;
    /** In a side-by-side trial: which version this run is ("baseline" is the current one). */
    arm?: "baseline" | "challenger" | null;
    createdAt: string;
    hasRiskCue: boolean;
    learnerDistress: boolean;
    openedByLearnerAt: string | null;
  };
  session: {
    id: string;
    scenario: { id: string | null; title: string | null };
    learner: { id: number | null; name: string | null; level: string | null };
    tenantId: string | null;
    tenantName: string | null;
    startedAt: string | null;
    endedAt: string | null;
    turns: number;
  };
  transcript: ExpertTranscriptTurn[];
  cards: DebriefCardsData | null;
  cardVersion: number;
  versions: Array<{
    version: number;
    at: string;
    by: number;
    section: string;
    fields: string[] | null;
    note: string | null;
    flagId: string | null;
  }>;
  corrections: Array<{
    section: string | null;
    outcome: "kept" | "removed" | "corrected";
    note: string | null;
    at?: string;
  }>;
  flags: DebriefSessionFlag[];
  askAlly: {
    exchanges: DebriefAskAllyExchange[];
    totalCostUsd: number | null;
    distressItems: unknown[];
  };
  learnerDistress: {
    present: boolean;
    inSession: boolean;
    inAskAlly: boolean;
    riskCueTurns: number[];
  };
  skillEstimate: {
    progress: Array<{
      skill: string;
      trend: "more_consistent" | "about_the_same" | "too_early";
      evidence?: string;
    }>;
    skillWords: Array<{ skill: string; word: "strength" | "keep_practising" | "didnt_come_up" }>;
    learnerLevel: string | null;
    pastSessions: number | null;
  };
  /** The learner-progress reading (absent before ally-be sends it; null when none ran). */
  progress?: DebriefSessionProgress | null;
  howItWasMade: {
    recipe: string | null;
    releaseVersion: number | null;
    fallbackRung: number;
    revisionRounds: number;
    estimatedCostUsd: number | null;
    actualCostUsd: number | null;
    ceilingUsd: number | null;
    seconds: number | null;
    steps: DebriefRunStep[];
    checkFailures: Array<{ code: string; section: string; detail: string }>;
    error: string | null;
  };
  /** Hidden from an advisor (not on the Ally team) until they give a verdict. */
  judge: {
    hidden: boolean;
    overall?: number | null;
    belowBar?: boolean;
    hardFails?: Array<{ code: string; evidence: string }>;
    evaluatorOverall?: number | null;
    evaluatorHardFails?: Array<{ code: string; evidence: string }>;
    reasons?: DebriefJudgeReason[];
  };
  review: { by: number; at: string; action: string; note: string | null } | null;
  escalation: { at: string; note: string | null; by: { id: number; name: string | null } } | null;
  comments: ExpertComment[];
  /** Threads on this learner's earlier debriefs of the same scenario, newest first (spec C5). */
  earlierComments: ExpertComment[];
  verdict: { verdict: ExpertVerdict; hardFails: string[]; updatedAt: string | null } | null;
  /** The agreement questions under the verdict (who gives verdicts). */
  agreement?: { inSample: boolean; questions: AgreementQuestion[] } | null;
  queue: {
    position: number | null;
    total: number;
    previousRunId: string | null;
    nextRunId: string | null;
  };
  pendingActions: DebriefSessionPending[];
  viewer: DebriefViewer;
  can: {
    comment: boolean;
    decideFlags: boolean;
    publish: boolean;
    showTodaysDebrief: boolean;
    looksFine: boolean;
    correct: boolean;
    escalate: boolean;
    verdict: boolean;
    runAgain: boolean;
  };
}

export interface DebriefAttention {
  banners: Array<{
    kind:
      | "urgent"
      | "held"
      | "escalated"
      | "canary_reverted"
      | "approval_expiring"
      | "release_waiting"
      | "agent_off"
      | "cap"
      | "provider_down"
      | "language_not_recorded";
    level: "red" | "yellow";
    count?: number;
    oldestSince?: string;
    overdue?: boolean;
    message: string;
    link: {
      page: "session" | "home" | "pm_agent" | "settings" | "analytics";
      runId?: string;
      ideaId?: string;
      category?: string;
    };
  }>;
  counts: {
    urgent: number | null;
    oldestUrgentSince: string | null;
    escalatedToMe: number | null;
    pmAgentNeedsYou: number;
  };
  viewer: DebriefViewer;
}

export type DebriefAutonomyStep = "quick_test" | "gate_test" | "paired_trial" | "canary";
export type DebriefAutonomyKind = "settings" | "prompts" | "pinned_rules";
export type DebriefAutonomyValue = "auto" | "ask" | "off";
export type DebriefOrgOverride = "default" | "ask" | "never";

export interface DebriefAutonomyView {
  enabled: boolean;
  steps: DebriefAutonomyStep[];
  promote: "person";
  kinds: Array<{
    kind: DebriefAutonomyKind;
    configurable: boolean;
    cells: Record<DebriefAutonomyStep, DebriefAutonomyValue>;
    /** The canary's (the κ gate's step). */
    eligible: boolean;
    /** Learner try-outs may be switched on early (confirmed): agreement is the only thing missing. */
    overridable?: boolean;
    reason: string;
    /** Per step: quick test, gate test and paired trial need only a clean record (plan §4). */
    eligibility?: Record<DebriefAutonomyStep, { eligible: boolean; reason: string }>;
    relockedAt: string | null;
    relockReason: string | null;
    /** The owner set the canary on its own before the κ gate (an override). */
    override?: { at: string; by: number; name: string | null } | null;
    /** The latest re-lock by the system whose cells still ask first. */
    relock?: { at: string; reason: string; steps: DebriefAutonomyStep[]; by: "system" } | null;
  }>;
  orgs: Array<{
    tenantId: string;
    tenantName: string;
    live: boolean;
    /** Switched off by an emergency stop; older ally-be builds leave it out. */
    stopped?: boolean;
    overrides: {
      paired_trial: DebriefOrgOverride;
      canary: DebriefOrgOverride;
    };
  }>;
  facts: {
    gate: {
      met: boolean;
      failing: Array<{ measure: string; kappa: number | null; n?: number }>;
    };
    reverts: Partial<Record<DebriefAutonomyKind, number>>;
    failedBaseline: { failed: boolean; detail: string | null };
    judgeDrift: boolean | null;
  };
  relocks: Array<{ kind: DebriefAutonomyKind; at: string; reason: string }>;
  can: { change: boolean };
  /** Judge agreement with the clinical advisor (older servers: absent). */
  agreement?: DebriefAgreementView | null;
}

export interface DebriefMeasureAgreement {
  measure: AgreementMeasure;
  n: number;
  minReviews: number;
  kappa: number | null;
  agreementPct: number | null;
  /** Of the debriefs the advisor said No to, how many the judge also said No to. */
  recallOnNo: { caught: number; of: number; pct: number | null };
  state: "not_enough" | "undefined" | "below" | "met";
  passes: boolean;
}

export interface DebriefAgreementView {
  measures: DebriefMeasureAgreement[];
  gate: { met: boolean };
  minReviews: number;
  kappa: number;
  sample: { size: number; thisWeek: number; waiting: number };
}

export interface DebriefPinnedRulesView {
  rules: Array<{
    code: string;
    label: string;
    version: number | null;
    pinnedByRelease: boolean;
    inBundle: boolean;
    signedBy: { id: number; name: string | null } | null;
    signedAt: string | null;
    ideaId: string | null;
    writtenBy: { id: number; name: string | null } | null;
    writtenAt: string | null;
    note: string | null;
    /** The whole rule in force, for "Ask for a change". */
    text?: string | null;
  }>;
  /** Pinned-rule items still waiting (first versions included). */
  proposals?: Array<{
    id: string;
    change?: { promptCode?: string; firstVersion?: boolean } | null;
  }>;
}

/** One entry in the caller's in-app notification feed (`/v1/notifications`). */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  /** Deep-link hints only, e.g. `{ screen: "DebriefConsole", runId }`. */
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

/** Where a release came from (`release-history`). */
export type DebriefReleaseOrigin =
  | { kind: "idea"; ideaId: string; title: string; proposedBy: "pm_agent" | "person" }
  | {
      kind: "skills_store";
      by: { id: number; name: string | null } | null;
      promptCode: string;
      from: number | null;
      to: number;
      note: string | null;
    }
  | { kind: "code"; tag: string | null; promptCode: string | null; note: string | null }
  | { kind: "settings_change"; by: { id: number; name: string | null } | null; note: string | null }
  | { kind: "roll_back"; fromVersion: number | null; reason: string | null };

/** A Skills Store or code release waiting because it would undo a promoted change. */
export interface DebriefWaitingRelease {
  id: string;
  version: number;
  title: string;
  source: {
    kind: "skills_store" | "code";
    by: number | null;
    tag: string | null;
    promptCode: string | null;
    from: number | null;
    to: number | null;
    note: string | null;
  };
  wouldUndo: Array<{
    path: string;
    what: string;
    live: unknown;
    wouldBecome: unknown;
    changedBy: { version: number; ideaId: string | null; label: string };
  }>;
  problems: string[];
}

export interface DebriefReleaseHistoryItem {
  id: string;
  version: number;
  status: "live" | "retired";
  title: string;
  summary: string | null;
  cameFrom: DebriefReleaseOrigin;
  wentLiveAt: string;
  liveTimes: number;
  retired: null | {
    at: string;
    reason: "replaced" | "rolled_back";
    byVersion: number | null;
    why: string | null;
  };
}

export interface DebriefReleaseHistory {
  items: DebriefReleaseHistoryItem[];
  waiting: DebriefWaitingRelease[];
}

export type DebriefRungState = "passed" | "failed" | "running" | "waiting" | "skipped" | "off";

export interface DebriefLiveMetrics {
  debriefs: number;
  judged: number;
  judgeMedian: number | null;
  hardFails: number | null;
  costPerDebriefUsd: number | null;
  secondsToDebrief: number | null;
  period: { from: string; to: string | null };
}

export interface DebriefReleaseDetail extends DebriefReleaseHistoryItem {
  previous: { id: string; version: number } | null;
  notes: {
    summary: string | null;
    changes: Array<{
      area: string;
      what: string | null;
      why: string | null;
      before: string | null;
      after: string | null;
      source: "diff" | "written";
    }>;
    /** False when nothing explains it; `why` then says so. */
    written: boolean;
  };
  evidence: {
    beforeLive: {
      ladder: Array<{
        rung: "quick_test" | "gate_test" | "paired_trial" | "canary";
        state: DebriefRungState;
        detail: string | null;
      }>;
      ideaId: string | null;
    };
    whileLive: null | (DebriefLiveMetrics & { previous: DebriefLiveMetrics | null });
  };
  contents: {
    prompts: Array<{
      code: string;
      promptId: string | null;
      version: number | null;
      followsCurrent: boolean;
      changed: boolean;
      lock: "pinned" | "release_only";
    }>;
    recipes: Array<{
      key: string;
      steps: string[];
      maxRevisionRounds: number | null;
      shortForm: boolean;
      changed: boolean;
    }>;
    steps: Array<{
      step: string;
      model: string | null;
      backupModel: string | null;
      status: "on" | "off" | "fixed";
      createdBy: string;
      usedPct: number | null;
      costPerRunUsd: number | null;
      winRate: number | null;
      changed: boolean;
    }>;
    reply: string | null;
    orchestrator: unknown;
    settings: Array<{ key: string; value: unknown; budget: boolean; changed: boolean }>;
    pinned: Array<{ code: string; label: string; version: number | null; inRelease: boolean }>;
  };
  compareWith: string | null;
  can: { rollBack: boolean; writeNotes: boolean };
}

export interface DebriefReleaseCompare {
  prompts: Array<{
    code: string;
    pinned: boolean;
    before: { promptId: string; version: number; text: string } | null;
    after: { promptId: string; version: number; text: string } | null;
  }>;
}

/** "Propose a change" (`POST pm-agent/ideas/propose`). */
export interface DebriefProposal {
  title: string;
  why?: string;
  steps?: Array<{
    step: string;
    enabled?: boolean;
    model?: string | null;
    backupModel?: string | null;
  }>;
  settings?: { runCeilingUsd?: number; monthlyCapUsd?: number; passScore?: number };
  reply?: string;
  /** Ship these published Skills Store versions. */
  prompts?: Record<string, number>;
}

/** Analytics › Debriefs (`GET analytics?days=`). */
export interface DebriefAnalyticsView {
  windowDays: number;
  tiles: {
    runs: number;
    judgeMean: number | null;
    meetsTheBar: number | null;
    needsAPerson: number;
    costP50Usd: number | null;
    costP90Usd: number | null;
    spentThisMonthUsd: number | null;
  };
  cost: {
    perOrg: Array<{
      tenantId: string;
      tenantName: string;
      live: boolean;
      monthSpentUsd: number;
      monthRuns: number;
    }>;
    pool: {
      sessionsThisMonth: number;
      addedUsd: number | null;
      spentUsd: number | null;
      balanceUsd: number | null;
      monthlyCapUsd: number;
      capLeftUsd: number | null;
      runCeilingUsd: number;
    };
    learning: { spentUsd: number | null; budgetUsd: number; balanceUsd: number | null };
    burnRate: {
      perDayUsd: number | null;
      last7DaysUsd: number | null;
      projectedMonthUsd: number | null;
    };
  };
  /**
   * Agreement between the independent check and the clinical advisor's yes/no answers under
   * their verdicts (ally-be `DebriefAgreementService.view`); hand scoring was removed 2026-11-12.
   */
  judgeAgreement: null | {
    gate: { met: boolean; failing?: unknown[] };
    /** The agreement each measure needs (0.6). */
    kappa: number;
    /** Reviews a measure needs before its agreement counts (50). */
    minReviews: number;
    measures: Array<
      Pick<
        DebriefMeasureAgreement,
        "measure" | "n" | "kappa" | "agreementPct" | "recallOnNo" | "state" | "passes"
      >
    >;
    sample: { size: number; thisWeek: number; waiting: number };
  };
}

/** One Agent logs entry (`GET runs/:runId/logs`, CONSOLE_API.md "Agent logs"). */
export interface AgentLogEntry {
  seq: number;
  kind: "model" | "code";
  /** The step or agent: `writer`, `planner`, `dispatch`, `judge`, … */
  step: string;
  round: number | null;
  startedAt: string | null;
  /** The model the step asked for first. */
  model: string | null;
  /** The backup or fallback that ran instead. */
  fallbackModel: string | null;
  prompt: { code: string; version: number | null; href: string; inlined: boolean } | null;
  /** Model steps: the message exactly as sent (with `{{system_prompt}}`); code steps: the inputs. */
  input: unknown;
  output: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  ms: number | null;
  retries: number;
  error: string | null;
  attention: boolean;
}

export interface AgentLogsView {
  runId: string;
  /** The day full agent logs began to be kept (YYYY-MM-DD); null before any run had one. */
  loggedFrom: string | null;
  run: {
    sessionId: string;
    scenarioTitle: string | null;
    status: string;
    recipeKey: string | null;
    releaseVersion: number | null;
    language: string | null;
    costUsd: number | null;
    seconds: number | null;
  };
  entries: AgentLogEntry[];
  /** Each prompt version the entries name, once: `code@version` → its text. */
  prompts: Record<string, string>;
}
