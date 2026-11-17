import { PlanStage } from '../enum/product-planning.enum';

/**
 * What a plan knows about itself beyond Builder's session columns, stored in
 * `builder_sessions.plan` (jsonb).
 *
 * Its own column, NOT `metadata`: the interview-summary writer replaces
 * `metadata` wholesale from the copy it loaded, so a key written beside it by
 * another path could be lost to a turn that started before it landed (the same
 * reason `handoffContext` has its own column).
 *
 * Every field is optional: a plan grows this record stage by stage, and a
 * BUILD session never has one.
 */
export interface PlanRecord {
  /** Saved without any AI; the author has not started the copilot yet. */
  parked?: boolean;
  /** How the first words arrived. Informational. */
  captureMode?: 'typed' | 'voice';
  /** A `roadmap_idea_drafts` row this plan was created from. */
  migratedFromDraftId?: string;

  /** The private Idea stage: the copilot's last verdict, held server-side. */
  idea?: PlanIdeaState;

  /** Set by filing. The opportunity also points back via `builderSessionId`. */
  filedAt?: string;
  opportunityId?: string;

  /**
   * The last thing the author did (start, a turn, filing, restore). Expiry
   * counts from this, not from `updatedAt`, which system writes also bump.
   */
  lastActiveAt?: string;
  /** Claimed by a filing in flight, so a double click files once. */
  filingAt?: string | null;

  /** Expiry warnings already sent, so a daily job never repeats one. */
  expiryWarnings?: ('archive' | 'purge')[];

  /** Lead workflow (P3). */
  nudgedAt?: string | null;
  handBackNote?: string | null;

  /** What the plan touches, from the lead and from code (P3/P4). */
  impactTags?: PlanImpactTag[];

  /** The success measure (PRD schema v2, P3); frozen at design approval. */
  successMeasure?: PlanSuccessMeasure | null;
  measureFrozenAt?: string | null;

  /** Closed as not pursuing. */
  closed?: PlanClosure | null;

  /** The research planner's test of the riskiest assumption (P10). */
  research?: PlanResearchPlan | null;

  /** Launch checklist (P9). */
  launch?: PlanLaunchState | null;

  /** Review dates and how many reviews are done (P8). */
  reviews?: { dueDates: string[]; done: number } | null;

  /**
   * This plan's own spend ceiling in USD, once a lead or an Owner raised it
   * (Roadmap v2, §5.6). Absent means the settings ceiling (planCeilingUsd).
   */
  ceilingUsd?: number | null;

  /**
   * Roadmap v2 (P3): the draft's code, allocated from the opportunity code
   * sequence when New idea creates the session, and kept by the opportunity
   * Submit creates. Unique among plan sessions (migration 1983300000000).
   */
  code?: string;
  /** Roadmap v2 draft page: the idea as the author has written it (autosaved). */
  draftText?: string;
  /** Roadmap v2 draft page: the product goal the author picked (roadmap_product_goals.id). */
  draftGoalId?: string | null;
  /** Bumps on every autosave, for the page's stale-write check. */
  draftVersion?: number;
  /** Set by Submit (P3): false until Start planning is pressed (P3b). */
  planningStarted?: boolean;
  planningStartedAt?: string | null;
  planningStartedBy?: number | null;
  /** Questions whose answers conflict and wait for the settler (P3b), for the read model. */
  openConflicts?: number;

  /**
   * The build brief was sent to Claude Code (Roadmap v2, D18): who and when.
   * Sending again re-stamps it. Its presence lets code-matched PRs drive
   * release and moves the idea to Building once such a PR exists.
   */
  externalBuild?: PlanExternalBuild | null;

  /** Last stage written, with when — mirrors the planStage column. */
  lastStage?: PlanStage;
}

export interface PlanExternalBuild {
  tool: 'claude_code';
  byUserId: number;
  at: string;
}

export interface PlanIdeaState {
  /** The copilot's working brief, echoed back on the next turn. */
  brief?: unknown;
  /** One verdict per readiness criterion, from the last turn. */
  gates?: { id: string; met: boolean; note?: string }[];
  /** Present only when every criterion is met. */
  draft?: {
    description: string;
    productGoal: string | null;
    effort: string | null;
  } | null;
  /** Minted by the copilot over that exact draft and brief. */
  readinessToken?: string | null;
  lastTurnAt?: string;

  // ── Roadmap v2 draft page (P3) ──
  /** Verbatim words that met each check, keyed by check id (Check my idea, §4.13). */
  evidence?: Record<string, string>;
  /** The copilot's goal suggestion from the same turn (§4.11), a product goal name. */
  suggestedGoal?: string | null;
  /** Checks the author reopened with "Not quite"; cleared by the next turn. */
  reopened?: string[];
  /** "Fill it in yourself": the author's own five answers, keyed by check id. */
  selfCheck?: Record<string, string> | null;
  /** Failed copilot turns in a row; two offer Fill it in yourself. */
  turnFailures?: number;
}

export type PlanImpactTagId =
  | 'stores_or_moves_personal_data'
  | 'sends_user_content_to_llm'
  | 'learner_or_client_facing_ai'
  | 'crisis_or_helpline_path'
  | 'recordings_or_transcripts'
  | 'minors_possible'
  | 'prompt_or_model_change'
  | 'ui_change'
  | 'mobile'
  | 'cross_tenant'
  | 'export';

export interface PlanImpactTag {
  id: PlanImpactTagId;
  /** `code` tags come from file paths the plan touches and cannot be removed. */
  source: 'lead' | 'code';
  /** Why code added it (the matching path), or who added it. */
  reason?: string;
  at: string;
}

export interface PlanSuccessMeasure {
  metric: string;
  baseline: string | null;
  target: string;
  guardrails: string[];
  /** How it is measured: an analytics question the outcome review re-asks, or a manual method. */
  method: { kind: 'analytics_question' | 'manual'; spec: string };
  /** Days after release when each outcome review runs. */
  reviewAfterDays: number[];
}

export interface PlanClosure {
  at: string;
  by: number;
  reason: string;
  /** The second Lead, when the idea had more votes than the threshold. */
  confirmedBy?: number | null;
  /** Waiting on a second Lead. */
  pendingConfirmation?: boolean;
}

export interface PlanLaunchState {
  /** Drafted proposals; a person publishes each through its own surface. */
  items: {
    id: string;
    kind:
      | 'product_update'
      | 'changelog'
      | 'tooltip'
      | 'tenant_comms'
      | 'rollout'
      | 'training_notes'
      | 'support_notes';
    title: string;
    body: string;
    done: boolean;
    doneBy?: number | null;
    doneAt?: string | null;
  }[];
  draftedAt?: string;
  launchedAt?: string | null;
}

export interface PlanResearchPlan {
  assumption: string;
  who: string;
  questions: string[];
  alternativeTest: string;
  decisionRule: string;
  draftedAt: string;
}
