/**
 * Builder types. Mirrors ally-be `src/builder/type/*` and its enums — the two
 * are hand-kept in step, so a change on either side needs the other.
 */

export type BuilderSessionStatus =
  | "INTERVIEWING"
  | "PRD_READY"
  | "BUILDING"
  | "WAITING_FOR_INPUT"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type BuilderStage =
  | "SETUP"
  | "PLANNING"
  | "CODING"
  | "TESTING"
  /** The machine test gate — every touched repo's tests, lint and typecheck. */
  | "GATE"
  | "VERIFYING"
  /** A coder pass fixing gate failures or reviewer objections. */
  | "REMEDIATING"
  /** E2E, push and PRs — only reached once the gate and reviewer are happy. */
  | "FINALISING"
  | "E2E_VERIFY"
  | "OPENING_PRS"
  | "REPORTING"
  | "DONE";

export interface BuilderSession {
  id: string;
  title: string;
  slug: string;
  status: BuilderSessionStatus;
  currentStage: BuilderStage | null;
  repos: string[] | null;
  model: string | null;
  lastMessageSeq: number;
  budgetUsd: string | null;
  totalCostUsd: string;
  runnerMinutes: number;
  error: string | null;
  /** Set once anyone archives the session; the feed is shared across Builder users. */
  archivedAt: string | null;
  /** User id of whoever started the session. */
  createdBy: number;
  /** Display name of whoever started it (email when blank); null if the user is gone. */
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The archived-only feed view: paginated, unlike the default list above. */
export interface BuilderArchivedSessionsPage {
  sessions: BuilderSession[];
  totalCount: number;
}

/* ── PRD document ───────────────────────────────────────────────────────── */

export interface BuilderPrdRequirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface BuilderPrdAssumption {
  id: string;
  text: string;
  status: "confirmed" | "unconfirmed";
}

export interface BuilderPrdRepoPlan {
  repo: string;
  changesMd: string;
}

export interface BuilderPrdDocument {
  title: string;
  summary: string;
  problem: string;
  usersAndContext: string;
  /** What the platform already does here — written before any requirement is. */
  existingBehaviour: string;
  whereChangesBelong: string;
  goals: string;
  nonGoals: string;
  requirements: BuilderPrdRequirement[];
  assumptions: BuilderPrdAssumption[];
  technicalPlan: {
    repos: BuilderPrdRepoPlan[];
    dataModelMd: string;
    apiMd: string;
  };
  testPlanMd: string;
  e2ePlanMd: string;
  openQuestions: string[];
  ui?: { interview?: Record<string, boolean> };
  /**
   * The technical design drafted from this PRD by a read-only agent, then
   * critiqued and approved by an admin before a build may start. Absent until
   * someone asks for one.
   */
  technicalDesign?: BuilderTechnicalDesign | null;
}

/* ── Technical design ───────────────────────────────────────────────────── */

export type BuilderTechnicalDesignStatus = "drafting" | "review" | "approved" | "failed";

export interface BuilderDesignScope {
  repo: string;
  files: string[];
}

export interface BuilderDesignContract {
  name: string;
  change: string;
  /** Each as `repo:path:line`. */
  readers: string[];
}

export interface BuilderDesignTest {
  requirementId: string;
  repo: string;
  file: string;
  asserts: string;
}

export interface BuilderDesignReview {
  /** "concerns" exactly when `defects` is non-empty (reviews from before the split: as filed). */
  verdict: "pass" | "concerns";
  notesMd: string;
  /** What would make the build wrong or a released client break. */
  defects?: string[];
  /** Scope the design could widen to — a person's call, not a failure. */
  suggestions?: string[];
  at: string;
}

export interface BuilderTechnicalDesign {
  status: BuilderTechnicalDesignStatus;
  runId: string | null;
  designMd: string;
  scope: BuilderDesignScope[];
  contracts: BuilderDesignContract[];
  compatibilityMd: string;
  testMap: BuilderDesignTest[];
  /** Each one blocks approval until it is settled. */
  openDecisions: string[];
  review: BuilderDesignReview | null;
  /** Hash of the PRD the design was drafted from — how staleness is decided. */
  productHash: string;
  draftedAt: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  error: string | null;
}

export interface BuilderDesignReadiness {
  ready: boolean;
  /** The PRD changed after the design was drafted or approved. */
  stale: boolean;
  blockers: string[];
}

export interface BuilderPrdReadinessSection {
  key: string;
  label: string;
  ok: boolean;
  /** One short sentence — this is what the section tooltip renders. */
  hint: string;
  /**
   * The same gap spelled out for the interview agent (JSON Pointers, field
   * names, legal values). Deliberately not rendered: it is long by design and
   * belongs in the agent's tool results, not in a tooltip.
   */
  detail?: string;
}

export type BuilderPrdReviewCategory =
  | "contradiction"
  | "unsupported_claim"
  | "unapplied_correction"
  | "missed_reuse"
  | "missing_success_metric";

/** One thing the cold PRD reviewer objected to. Mirrors ally-be's BuilderPrdReviewFinding. */
export interface BuilderPrdReviewFinding {
  /** "F1", "F2"… */
  id: string;
  category: BuilderPrdReviewCategory;
  /** The PRD key it is about — a key of `en.builder.prd.sections`. */
  section: string;
  detail: string;
  fix: string;
  quote?: string;
  status: "open" | "fixed" | "dismissed";
  raisedInVersion: number;
  fixedInVersion?: number;
  /** The recheck's one line on why it reads resolved, or still open. */
  checkNote?: string;
  dismissal?: {
    reason: string;
    by: number;
    at: string;
    /** `interview` when the agent recorded the admin's own words. */
    via: "admin" | "interview";
  };
}

/**
 * The cold reviewer's record on the PRD. It runs once, the first time every
 * other readiness row passes; each open finding then blocks until a recheck
 * finds it fixed or someone dismisses it with a reason.
 */
export interface BuilderPrdReview {
  /** `failed`: the reviewer itself could not run. That does not block. */
  status: "done" | "failed";
  versionNumber: number;
  checkedVersion: number;
  model: string | null;
  reviewedAt: string;
  checkedAt: string;
  findings: BuilderPrdReviewFinding[];
  error?: string | null;
}

export interface BuilderPrdReadiness {
  score: number;
  ready: boolean;
  sections: BuilderPrdReadinessSection[];
  /** `hint` + `detail` per blocked section. Counted here, not read. */
  blockers: string[];
  /** Null before the first review; absent from servers that predate it. */
  review?: BuilderPrdReview | null;
}

export interface BuilderPrdVersion {
  id: string;
  versionNumber: number;
  author: "agent" | "admin";
  changeSummary: string | null;
  createdAt: string;
}

/* ── Chat + SSE ─────────────────────────────────────────────────────────── */

export type BuilderQuestionKind = "freeText" | "singleSelect" | "multiSelect" | "dropdown";

export interface BuilderQuestionOption {
  id: string;
  label: string;
  /** The trade-off in one line — what makes an option pickable at a glance. */
  description?: string;
  /** At most one per question; the UI focuses it for one-key answering. */
  recommended?: boolean;
}

export interface BuilderQuestionEvent {
  id: string;
  prompt: string;
  kind: BuilderQuestionKind;
  options?: BuilderQuestionOption[];
  allowCustom?: boolean;
  allowNone?: boolean;
  minSelections?: number;
  maxSelections?: number;
  /** Why this is being asked; rendered as a subtitle on the card. */
  rationale?: string;
  /**
   * Under the interview protocol: the kind of decision this asks for (scope, behaviour,
   * priority, taste, contradiction). Its basis and why it is the admin's call are in `rationale`.
   */
  questionType?: string;
}

/**
 * The situation brief: the opening turn of an interview under the protocol
 * (builder_settings.situationBrief) — what already exists, what is already met, a proposal per
 * part and the repos, each line confirmed or corrected by the admin. Mirrors ally-be's
 * `BuilderSituationBrief`. Agent-adjacent JSON: read it through `normalizeSituationBrief`.
 */
export type BuilderBriefLineKind = "exists" | "alreadyMet" | "proposal" | "repo";

export interface BuilderBriefLine {
  /** X1… exists, M1… already met, P1… proposals, R1… repos. */
  id: string;
  kind: BuilderBriefLineKind;
  text: string;
  /** What the line rests on, ready to display: `capability_lookup "debrief" — …`. */
  cites: { ref: string; label: string }[];
  part?: string;
  approach?: "reuse" | "extend" | "new";
  repo?: string;
}

export interface BuilderSituationBrief {
  id: string;
  message: string;
  lines: BuilderBriefLine[];
  createdAt?: string;
}

/** The admin's answer to a brief, line by line. */
export interface BuilderBriefResponse {
  briefId: string;
  lines: { id: string; verdict: "confirm" | "correct"; correction?: string }[];
  note?: string;
}

/** Structured answer payload posted back with the next turn. */
export interface BuilderStructuredAnswer {
  selectedOptionIds?: string[];
  customValues?: string[];
  none?: boolean;
}

export interface BuilderDoneEvent {
  messageSeq: number;
  sessionStatus: BuilderSessionStatus;
  readinessScore: number;
}

/**
 * What one assistant turn read, searched, changed in the PRD and failed at — composed by the server
 * from what actually happened, so every string is ready to display. Mirrors ally-be's
 * `BuilderTurnReceipt`. Agent-adjacent JSON: read every field through an `Array.isArray` guard.
 */
export interface BuilderTurnReceipt {
  /** Files and pages read: `ally-be/src/builder/x.ts`, `Stacks: 2 chunks`. */
  read: string[];
  /** Searches and lookups with what came back: `Code search "debrief rating" — 4 matches`. */
  searched: string[];
  /** What changed in the PRD, by section, requirement id and repo: `Requirements: added R4`. */
  changed: string[];
  /** PRD version before and after the turn; equal when nothing changed. */
  prdVersion: { from: number; to: number };
  /** Lookups and edits that failed: `Read ally-be/src/x.ts — Not Found`. */
  failed: string[];
  /** Problems the reply was delivered with anyway. */
  warnings: string[];
  /** Builder's stated reason the PRD did not change after a message in the admin's own words. */
  prdUnchangedBecause?: string | null;
}

export type BuilderStreamEvent =
  | { type: "token"; data: { delta: string } }
  | { type: "tool_call"; data: { name: string; input: Record<string, unknown> } }
  | { type: "tool_result"; data: { name: string; summary: string } }
  | { type: "question"; data: BuilderQuestionEvent }
  | {
      type: "prd_draft";
      data: { draft: BuilderPrdDocument; versionNumber: number };
    }
  | { type: "readiness"; data: BuilderPrdReadiness }
  /** Once per turn, just before `done`. */
  | { type: "receipt"; data: BuilderTurnReceipt }
  /** The opening turn's situation brief, under the interview protocol. */
  | { type: "situation_brief"; data: BuilderSituationBrief }
  | { type: "error"; data: { code: string; message: string } }
  | { type: "done"; data: BuilderDoneEvent }
  | { type: "ping"; data: { at: number } };

/** One rendered row in the chat feed. */
export interface BuilderChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** A situation brief card. */
  brief?: BuilderSituationBrief;
  /** Set once the brief has been answered, so the card renders locked with the verdicts. */
  answeredBrief?: BuilderBriefResponse;
  /**
   * Tool activity for this turn, shown as chips above the bubble. Live progress only: once the
   * turn's `receipt` lands the chips are cleared, and a reloaded row that has a receipt never gets
   * them — the receipt is the record.
   */
  toolNotes?: string[];
  /** What the turn did, drawn under the bubble. Absent on rows from before receipts existed. */
  receipt?: BuilderTurnReceipt;
  question?: BuilderQuestionEvent;
  /** Set on resume so an answered card renders locked. */
  answeredWith?: string;
  answeredAnswer?: BuilderStructuredAnswer;
  isStreaming?: boolean;
  interrupted?: boolean;
  error?: string;
}

/** Persisted transcript row, as returned by GET /builder/sessions/:id. */
export interface BuilderServerMessage {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string | null;
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[] | null;
  toolResults?: { toolUseId: string; name: string; result: unknown }[] | null;
  metadata?: {
    questions?: BuilderQuestionEvent[];
    questionId?: string;
    answer?: BuilderStructuredAnswer;
    /** The turn died — set by the server so a reload still shows the failure. */
    errored?: boolean;
    /** What to tell the admin about it; falls back to generic copy. */
    errorMessage?: string;
    /** What the turn did. Absent on rows from before receipts existed. */
    receipt?: BuilderTurnReceipt;
    /** The agent's private prose for the turn. Never rendered. */
    workingNotes?: string[];
    [key: string]: unknown;
  } | null;
  createdAt: string;
}

export interface BuilderSessionDetail extends BuilderSession {
  messages: BuilderServerMessage[];
  prd: BuilderPrdDocument;
  prdVersionNumber: number;
  readiness: BuilderPrdReadiness;
  /** Whether the technical design can be approved, and whether a build may rely on it. */
  designReadiness?: BuilderDesignReadiness;
  /** Display name of the admin who started the session (email when blank). */
  createdByName?: string | null;
}

/* ── Builds ─────────────────────────────────────────────────────────────── */

export type BuilderRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "WAITING_FOR_INPUT";

export interface BuilderBuildRun {
  id: string;
  sessionId: string;
  sequence: number;
  /**
   * `fix` is a run dispatched from Bug Hunter's build-a-fix flow, not a session
   * resume; `review` is Builder reviewing its own pull request; `design` is the
   * read-only technical-design pass that runs before a build.
   */
  mode: "build" | "resume" | "fix" | "review" | "design";
  status: BuilderRunStatus;
  model: string;
  branchSlug: string;
  branches: Record<string, string> | null;
  githubRunUrl: string | null;
  dispatchedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastEventSeq: number;
  /** Null for issue builds: no cost or runner time is reported for them. */
  costUsd: string | null;
  runnerMinutes: number | null;
  error: string | null;
  /**
   * Set only on an issue build — Builder raised a GitHub issue and opencode
   * works it in the repo's own Actions. `issueNumber != null` is THE test for
   * one (see `isIssueRun`). On such a run `githubRunUrl` is the issue, not a
   * log; the opencode log is `cost.issueWorkflowRunUrl`.
   */
  issueNumber?: number | null;
  issueUrl?: string | null;
  /** The one repo an issue build targets; null on legacy runs. */
  repos?: string[] | null;
  /** The repo milestone this run builds, when the design was split per repo. */
  milestoneId?: string | null;
  /** Set on a review (or fix) run: the pull request it is working on. */
  pullRequestId?: string | null;
  /**
   * Legacy runs keep spend bookkeeping here. Issue runs reuse the column for
   * where the issue has got to — see `issueProgress`.
   */
  cost?: BuilderRunCost | null;
}

export interface BuilderRunCost {
  /**
   * Ordered, each key once: `issue`, `working:<actionsRunId>`, `pr:<n>`,
   * `ci-pending:<sha>`, `ci-fail:<sha>`, `fix:<sha>`, `ci-pass:<sha>`.
   */
  issueTimeline?: string[];
  /** Commits Builder asked opencode to fix CI on. At most two per build. */
  issueFixRequests?: string[];
  /** opencode's Actions run — absent until opencode starts. */
  issueWorkflowRunUrl?: string;
  [key: string]: unknown;
}

export type BuilderMilestoneStatus =
  | "PENDING"
  | "BUILDING"
  | "WAITING_FOR_INPUT"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

/**
 * A slice of a session's work. A design that changes several repos becomes one
 * milestone per repo (`repos` = [thatRepo]), built in a fixed order; an epic
 * milestone has `repos` null.
 */
export interface BuilderMilestone {
  id: string;
  sessionId: string;
  position: number;
  title: string;
  summaryMd: string;
  repos: string[] | null;
  status: BuilderMilestoneStatus;
  branchSlug: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export type BuilderEventType =
  | "text"
  | "tool_call"
  | "tool_result"
  | "file_edit"
  | "todo"
  | "test_output"
  | "stage_change"
  | "plan"
  | "verification"
  /** A machine-run check result — verified, not self-reported. */
  | "gate_result"
  /** The target repo's own CI verdict on an issue build's pull request. */
  | "ci_result"
  | "phase_cost"
  /**
   * Legacy runner builds only, kept so their history still renders: a run
   * parked at a phase boundary because the spend ceiling was gone.
   * `payload.state`: `held`, `raised` or `expired`.
   */
  | "budget_hold"
  | "question"
  | "e2e_evidence"
  | "e2e_skipped"
  | "pr_opened"
  | "report"
  | "cost"
  | "error"
  | "done";

/**
 * Live spend against the session's ceiling.
 *
 * Polled while a build is running rather than read off the session, whose
 * detail response is fetched once: the spend moves every phase.
 */
export interface BuilderBudgetState {
  budgetUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  exceeded: boolean;
}

export interface BuilderBuildEvent {
  id: string;
  runId: string;
  seq: number;
  stage: BuilderStage | null;
  type: BuilderEventType;
  payload: Record<string, any>;
  createdAt: string;
}

export interface BuilderPullRequest {
  id: string;
  repo: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  title: string | null;
  ciStatus: string | null;
  /**
   * open / closed, as GitHub reports it. Distinct from `merged`: a pull request
   * closed *without* merging is closed and not merged, and the Merge control
   * must stay hidden for it. Optional because rows predating the column carry
   * NULL, which reads as "not known to be closed" rather than as closed.
   */
  state?: string | null;
  merged: boolean;
  mergedAt: string | null;
  /**
   * Set when Builder's review-and-fix loop gave up on this pull request and
   * handed it to a person: no more fix requests, reviews or approvals from
   * Builder until someone resumes it. Optional for rows predating the column.
   */
  needsHumanAt?: string | null;
  /** Why, as one plain sentence written by the server. Rendered as given. */
  needsHumanReason?: string | null;
  /** Fix requests Builder has made on this pull request so far. */
  fixRunCount?: number;
  /** The pull request's current head commit. */
  headSha?: string | null;
  /** The commit Builder's review last passed clean; equal to headSha = still clean. */
  reviewPassedSha?: string | null;
  /** What Builder's review and `/oc` fixes on this pull request cost so far, USD. */
  automationCostUsd?: string | null;
  /**
   * One entry per review Builder ran on it; the first entry's `at` starts the
   * pull request's automation time box.
   */
  reviewHistory?: { sha: string | null; count: number; keys: string[]; at?: string }[] | null;
  /**
   * Where its production release got to. `unhealthy` = deployed, but the
   * health check after the release failed.
   */
  releaseState?: "releasing" | "released" | "failed" | "skipped" | "unhealthy" | null;
}

export type BuilderPrFeedbackStatus =
  | "pending"
  | "in_fix"
  | "addressed"
  | "dismissed"
  | "stale"
  | "observed";

/** A CI failure or review finding on one of the session's pull requests. */
export interface BuilderPrFeedback {
  id: string;
  pullRequestId: string;
  sessionId: string;
  kind: "agent_review" | "ci_failure" | "review_comment" | "review";
  status: BuilderPrFeedbackStatus;
  author?: string | null;
  body: string | null;
  path: string | null;
  line: number | null;
}

export interface BuilderSettings {
  id: string;
  enabled: boolean;
  /** Whether Builder reviews its own open pull requests. Writes findings, touches no branch. */
  autoReviewEnabled: boolean;
  /** Whether a review that found nothing may submit an approving review. */
  autoApproveEnabled: boolean;
  autoMergeEnabled: boolean;
  /** Whether a merged pull request releases itself to production. */
  autoReleaseEnabled: boolean;
  /** Whether Builder may push commits to its own open pull requests. */
  autoFixEnabled: boolean;
  /** Ceiling on fix runs per pull request. */
  maxFixRunsPerPr: number;
  maxConcurrentBuilds: number;
  defaultBudgetUsd: string | null;
  /**
   * Per-tier models for design runs (the designer, the critic, and the
   * fallback). Null falls through to the platform default.
   */
  plannerModel: string | null;
  coderModel: string | null;
  verifierModel: string | null;
  /** The switches above, read as one level; `custom` is any other mix. */
  autonomyLevel?: BuilderAutonomyLevel;
  /** Over Builder's last `window` reviewed opencode pull requests. */
  trackRecord?: BuilderTrackRecord;
  /** Set when the track record has earned the next level. */
  suggestedLevel?: "auto_merge" | "auto" | null;
  /** How long Builder keeps reviewing and fixing one pull request, from its first review. */
  automationTimeboxMs?: number;
  /** Most Builder may spend on one pull request's review and fixes, USD; null/0 = no limit. */
  maxPrAutomationUsd?: string | null;
  /**
   * The interview kill switch for validated turns: the reply arrives after the agent's lookups
   * were read and its PRD edits landed, with a receipt. Off falls back to the previous loop.
   * Absent from servers that predate it.
   */
  validatedTurns?: boolean;
  /**
   * The interview protocol: a discovery sweep and a situation brief before the first question,
   * then the question gate. Needs `validatedTurns`. Absent from servers that predate it.
   */
  situationBrief?: boolean;
}

export type BuilderAutonomyLevel = "off" | "assist" | "auto_merge" | "auto" | "custom";

export interface BuilderTrackRecord {
  window: number;
  cleanReviewed: number;
  mergedAsReviewed: number;
  escalated: number;
  unhealthyReleases: number;
}

export interface BuilderNotification {
  id: string;
  sessionId: string;
  kind:
    | "question_pending"
    | "build_completed"
    | "build_failed"
    | "prs_opened"
    | "budget_reached"
    | "pr_needs_human";
  message: string;
  readAt: string | null;
  createdAt: string;
}

/* ── Requests ───────────────────────────────────────────────────────────── */

export interface CreateBuilderSessionRequest {
  title?: string;
}

export interface UpdateBuilderSessionRequest {
  id: string;
  title?: string;
  repos?: string[];
  model?: string;
}

export interface BuilderPrdPatchOp {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

export interface PatchBuilderPrdRequest {
  id: string;
  ops: BuilderPrdPatchOp[];
  changeSummary?: string;
}

export interface DismissBuilderReviewFindingRequest {
  id: string;
  findingId: string;
  reason: string;
}

export interface DismissBuilderReviewFindingResponse {
  readiness: BuilderPrdReadiness;
  /** The session status after re-scoring — a dismissal can make the PRD ready. */
  status: BuilderSessionStatus;
}

export interface PatchBuilderPrdResponse {
  prd: BuilderPrdDocument;
  readiness: BuilderPrdReadiness;
  versionNumber: number;
}

export interface BuilderRepoCommand {
  repo: string;
  description: string;
  test: string;
  lint: string;
  typecheck: string | null;
  e2eCapable: boolean;
  guardedPaths: string[];
}

export interface BuilderRepoMapSummary {
  repo: string;
  commitSha: string | null;
  generatedAt: string | null;
  stats: Record<string, unknown> | null;
}

/* ── Scoreboard ─────────────────────────────────────────────────────────── */

export type BuilderScoreboardOutcome = "merged" | "open" | "failed" | "cancelled";

export interface BuilderScoreboardBuild {
  sessionId: string;
  title: string;
  repos: string[];
  createdAt: string;
  outcome: BuilderScoreboardOutcome;
  /** First dispatch to last completion — includes any wait for a person. */
  durationHours: number | null;
  /** The sum of the runs' own wall clocks: machine time only. */
  machineMinutes: number | null;
  /** The remainder — time parked on a question. Null when unmeasurable. */
  humanWaitMinutes: number | null;
  costUsd: number;
  runCount: number;
  fixRunCount: number;
  reviewCommentCount: number;
  ciFailureCount: number;
  timeToMergeHours: number | null;
  failureTags: string[];
}

export interface BuilderScoreboardTrendWeek {
  weekStart: string;
  builds: number;
  mergeRate: number;
  medianCostUsd: number;
  medianFixRuns: number;
  medianTimeToMergeHours: number | null;
}

export interface BuilderScoreboardTotals {
  builds: number;
  merged: number;
  mergeRate: number;
  totalCostUsd: number;
  medianCostUsd: number;
}

export interface BuilderScoreboard {
  builds: BuilderScoreboardBuild[];
  trends: BuilderScoreboardTrendWeek[];
  totals: BuilderScoreboardTotals;
  /**
   * Where the losses come from, across the window. The backend has always
   * returned this; nothing rendered it, so the one view that could point effort
   * at a cause showed only per-build tags you had to tally by eye.
   */
  failureTags: { tag: string; count: number }[];
}

/* ── Pipeline health: where a run's time and money go ───────────────────────
 *
 * Every measurement here is nullable and that is load-bearing, not defensive.
 * Runs dispatched before the runner reported timings have a cost record with no
 * clock, so `null` means "not measured" and must never render as 0 — a phase
 * shown as taking no time reads as instant rather than unknown. */

export interface BuilderPipelinePhase {
  /** plan, code-1, verify-2, finalise, fix … */
  phase: string;
  model: string | null;
  invocations: number;
  totalCostUsd: number | null;
  medianCostUsd: number | null;
  /** Wall clock of the invocation. */
  medianWallMs: number | null;
  p95WallMs: number | null;
  /** Of the wall clock, the part spent waiting on the model. */
  medianApiMs: number | null;
  medianTurns: number | null;
}

export interface BuilderPipelineGate {
  repo: string;
  /** test | lint | typecheck */
  kind: string;
  results: number;
  passed: number;
  /** null when there is no evidence either way, which is not the same as 0%. */
  passRate: number | null;
}

export interface BuilderPipelineOutcome {
  status: BuilderRunStatus;
  mode: string;
  runs: number;
  medianRunnerMinutes: number | null;
}

export interface BuilderPipelineHealth {
  windowDays: number;
  phases: BuilderPipelinePhase[];
  gates: BuilderPipelineGate[];
  outcomes: BuilderPipelineOutcome[];
}

/* ── Knowledge: lessons + exemplars ────────────────────────────────────── */

export type BuilderLessonStatus = "candidate" | "active" | "merged" | "retired";

export interface BuilderLesson {
  id: string;
  lesson: string;
  category: string;
  status: BuilderLessonStatus;
  /**
   * A pinned lesson is exempt from the automatic curator's edits and
   * retirement — a person put it there on purpose, and the periodic
   * consolidation pass must not touch it.
   */
  pinned: boolean;
  sourceCount: number;
  timesApplied: number;
  timesContradicted: number;
  repos: string[];
  tags: string[];
  createdAt: string;
}

export interface PatchBuilderLessonRequest {
  id: string;
  lesson?: string;
  category?: string;
  status?: BuilderLessonStatus;
  pinned?: boolean;
  tags?: string[];
}

export interface BuilderExemplar {
  id: string;
  sessionId: string;
  title: string;
  repos: string[];
  outcome: BuilderScoreboardOutcome;
  fixRunCount: number;
  reviewCommentCount: number;
  ciFailureCount: number;
  costUsd: number;
  timeToMergeHours: number | null;
  failureTags: string[];
  summaryMd: string;
  createdAt: string;
}

/* ── Replay eval ────────────────────────────────────────────────────────────
 * Shapes of ally-be's `src/builder/eval`. A fixture is a recorded interview
 * (or one PRD) the eval plays again; a suite is fixtures run a few times; a
 * run is one fixture played once. Fixtures hold what a production admin typed,
 * so they live in the database of the environment they were made in. */

export type BuilderEvalFixtureKind = "interview" | "prd_review";

export type BuilderEvalChecklistKind = "must" | "must_not";

/** One line of ground truth a correct PRD must (or must not) satisfy. */
export interface BuilderEvalChecklistItem {
  /** "C1", "C2"… — what the simulated admin and the judge cite. */
  id: string;
  text: string;
  kind: BuilderEvalChecklistKind;
}

export interface BuilderEvalInterviewPayload {
  openingMessage: string;
  adminScript: string[];
  checklist: BuilderEvalChecklistItem[];
  handoffContext?: string | null;
  recordedPrd?: BuilderPrdDocument | null;
  pins?: Record<string, string>;
  maxTurns?: number;
  /** How a correct interview ends. Absent means a ready PRD. */
  expectedOutcome?: BuilderEvalExpectedOutcome;
}

/** `nothing_to_build`: the request is already met, and the right end is Builder saying so. */
export type BuilderEvalExpectedOutcome = "prd_ready" | "nothing_to_build";

/** How an interview replay ended; `neither` stopped short of both. */
export type BuilderEvalInterviewOutcome = BuilderEvalExpectedOutcome | "neither";

export interface BuilderEvalPrdReviewPayload {
  prd: BuilderPrdDocument;
  evidence?: { readOk: string[]; readFailed: string[] };
  transcript?: { role: "admin" | "builder"; text: string }[];
  /** `blocking: true` is a seeded defect; `false` is a clean control. */
  expect: { blocking: boolean; via?: string };
}

export type BuilderEvalPayload = BuilderEvalInterviewPayload | BuilderEvalPrdReviewPayload;

export interface BuilderEvalFixture {
  id: string;
  name: string;
  kind: BuilderEvalFixtureKind;
  sourceSessionId: string | null;
  payload: BuilderEvalPayload;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What `GET fixtures/export` returns and `POST fixtures/import` takes (its `fixtures`). */
export interface BuilderEvalFixtureExport {
  version: number;
  fixtures: Partial<BuilderEvalFixture>[];
}

export interface BuilderEvalImportResult {
  created: number;
  updated: number;
}

/** The deterministic checks. A passing run has every count at zero and both booleans true. */
export interface BuilderEvalGates {
  unseenFailures: number;
  askedBeforeReading: number;
  unrepairedEditFailures: number;
  falseUpdateClaims: number;
  /** Replies that told the admin "ready" while readiness said no. Absent on runs scored before it. */
  falseReadyClaims?: number;
  consistent: boolean;
  evidenceCited: boolean;
}

export interface BuilderEvalMetrics {
  turns: number;
  questions: number;
  corrections: number;
  correctedItems: string[];
  readyReached: boolean;
  /** How the replay ended. Absent on runs from before it was recorded. */
  outcome?: BuilderEvalInterviewOutcome;
  /** What the fixture expected when the run was scored. Absent on runs from before it was recorded. */
  expectedOutcome?: BuilderEvalExpectedOutcome;
  /** Share of the PRD's "is this written" rows that pass — 100 can still be not ready. */
  readinessScore: number;
  /** Absent on runs from before it was recorded. */
  readyAtEnd?: boolean;
  /** The readiness rows the final PRD failed. */
  blockersAtEnd?: { key: string; label: string }[];
  toolCalls: number;
  toolFailures: number;
  costUsd: number;
  durationMs: number;
}

export interface BuilderEvalJudgement {
  met: number;
  total: number;
  /** met / total, 0..1; 1 when the checklist is empty. */
  score: number;
  items: { id: string; met: boolean; evidence: string }[];
  model?: string | null;
  error?: string | null;
}

/** For a `prd_review` fixture: what the critic did with the PRD. */
export interface BuilderEvalCriticOutcome {
  blockingRows: string[];
  findings: { id: string; category: string; detail: string }[];
  asExpected: boolean;
}

/** One turn of a replay. `correction` marks a turn where the simulated admin corrected Builder. */
export interface BuilderEvalTurnRecord {
  turn: number;
  admin: string;
  correction?: boolean;
  builder: string;
  question?: string | null;
  toolCalls: { name: string; ok: boolean; summary?: string }[];
}

export type BuilderEvalRunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "errored"
  /** Never ran: its suite was cancelled first. */
  | "cancelled";

export interface BuilderEvalRun {
  id: string;
  suiteId?: string;
  fixtureId: string;
  /** 1-based. */
  repetition: number;
  status: BuilderEvalRunStatus;
  gates: BuilderEvalGates | null;
  metrics: BuilderEvalMetrics | null;
  judge: BuilderEvalJudgement | null;
  critic: BuilderEvalCriticOutcome | null;
  transcript: BuilderEvalTurnRecord[] | null;
  finalPrd: BuilderPrdDocument | null;
  error: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export type BuilderEvalSuiteStatus = "running" | "completed" | "errored" | "cancelled";

export type BuilderEvalSuiteTrigger = "manual" | "baseline" | "prompt_gate";

export interface BuilderEvalSuiteFixtureSummary {
  fixtureId: string;
  name: string;
  kind: BuilderEvalFixtureKind;
  runs: number;
  passed: number;
  gateViolations: number;
  corrections: number;
  judgeScore: number | null;
}

export interface BuilderEvalSuiteSummary {
  fixtures: BuilderEvalSuiteFixtureSummary[];
  runs: number;
  passed: number;
  errored: number;
  gateViolations: number;
  corrections: number;
  judgeScore: number | null;
  costUsd: number;
}

/** What a prompt-gate suite decided, and against what. */
export interface BuilderEvalVerdict {
  pass: boolean;
  reasons: string[];
  baselineSuiteId: string | null;
}

/** What a prompt-gate suite publishes if it passes. */
export interface BuilderEvalPromptCandidate {
  promptCode: string;
  content?: string | null;
  provider?: string | null;
  model?: string | null;
  temperature?: number | null;
}

export interface BuilderEvalSuite {
  id: string;
  trigger: BuilderEvalSuiteTrigger;
  status: BuilderEvalSuiteStatus;
  fixtureIds: string[];
  repetitions: number;
  candidate: BuilderEvalPromptCandidate | null;
  summary: BuilderEvalSuiteSummary | null;
  verdict: BuilderEvalVerdict | null;
  publishedAt: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface BuilderEvalSuiteDetail extends BuilderEvalSuite {
  runs: BuilderEvalRun[];
}

export interface StartBuilderEvalSuiteRequest {
  fixtureIds?: string[];
  /** 1–10; the backend defaults to 3. */
  repetitions?: number;
}

export interface SubmitBuilderEvalPromptCandidateRequest extends StartBuilderEvalSuiteRequest {
  promptCode: string;
  /** The new prompt text. Absent when only the model settings change. */
  content?: string;
  /** Empty string clears the override. */
  provider?: string;
  /** Empty string clears the override. */
  model?: string;
  /** `null` clears the override; a number sets it (0–2). */
  temperature?: number | null;
}

export interface CreateBuilderEvalFixtureFromSessionRequest {
  sessionId: string;
  name: string;
  checklist?: Pick<BuilderEvalChecklistItem, "text" | "kind">[];
  notes?: string;
}

export interface CreateBuilderEvalFixtureFromExportRequest {
  name: string;
  /** The body of `GET /v1/builder/sessions/:id` from another environment. */
  session: Record<string, unknown>;
  checklist?: Pick<BuilderEvalChecklistItem, "text" | "kind">[];
  notes?: string;
}

export interface UpdateBuilderEvalFixtureRequest {
  id: string;
  name?: string;
  notes?: string;
  active?: boolean;
  checklist?: BuilderEvalChecklistItem[];
}
