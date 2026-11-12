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
import { ExpertComment, ExpertTranscriptTurn, ExpertVerdict } from "./debriefExpertReview";

export type DebriefCanAction =
  | "comment"
  | "flagDecision"
  | "heldDebrief"
  | "escalate"
  | "verdict"
  | "score"
  | "pmAgent"
  | "approvePinnedRule"
  | "testSets"
  | "releases"
  | "switchOrgOn"
  | "emergencyStop"
  | "ownerSettings";

export interface DebriefViewer {
  roles: {
    allyTeam: boolean;
    clinicalAdvisor: boolean;
    owner: boolean;
    receivesEscalations: boolean;
  };
  can: Record<DebriefCanAction, boolean>;
  /** Shows the "To score" category and the "!" badge. */
  scorer: boolean;
}

export type DebriefHomeCategoryParam =
  | "needs"
  | "flagged"
  | "below"
  | "published"
  | "escalated"
  | "to_score"
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
  inMyScoringSample: boolean;
  toScore: boolean;
  waitingSince: string | null;
}

export interface DebriefSessionsPage {
  category: string;
  counts: {
    needs: number;
    urgent: number;
    flagged: number;
    below: number;
    published: number;
    escalated: number;
    toScore: number | null;
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
  /** The card the question was about, when ally-be sends it. */
  section?: string | null;
  firstWordsMs?: number | null;
}

export interface DebriefJudgeReason {
  source: "judge" | "evaluator" | "check";
  code: string;
  text: string;
  turns: number[];
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
  verdict: { verdict: ExpertVerdict; hardFails: string[]; updatedAt: string | null } | null;
  scoring: { inMyScoringSample: boolean; scoredByMe: boolean };
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
    score: boolean;
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
export type DebriefAutonomyKind = "settings" | "guidance" | "prompts" | "models" | "pinned_rules";
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
    eligible: boolean;
    reason: string;
    relockedAt: string | null;
    relockReason: string | null;
  }>;
  orgs: Array<{
    tenantId: string;
    tenantName: string;
    live: boolean;
    overrides: {
      paired_trial: DebriefOrgOverride;
      canary: DebriefOrgOverride;
      guidance: DebriefOrgOverride;
    };
  }>;
  facts: {
    gate: { met: boolean; failing: Array<{ measure: string; kappa: number | null }> };
    reverts: Partial<Record<DebriefAutonomyKind, number>>;
    failedBaseline: { failed: boolean; detail: string | null };
    judgeDrift: boolean | null;
  };
  relocks: Array<{ kind: DebriefAutonomyKind; at: string; reason: string }>;
  can: { change: boolean };
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
