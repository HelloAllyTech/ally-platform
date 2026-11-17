import { PlanStage } from '../enum/product-planning.enum';

/**
 * Everything a plan's stage is derived from. Facts, never a model's opinion
 * (plans/roadmap-owns-planning rev 5.2 §B.4): the LLM can propose to move on,
 * but only these decide where a plan is.
 */
export interface PlanStageFacts {
  private: boolean;
  closed: boolean;
  leadUserId: number | null;
  /** PRD readiness as the plan defines it (Builder readiness + success measure + checks). */
  prdReady: boolean;
  /** The technical design is approved and not stale. */
  designApproved: boolean;
  /** A build run exists or has existed for this session. */
  buildStarted: boolean;
  /** The opportunity's work is released (merged and deployed). */
  shipped: boolean;
  /** The launch checklist is complete. */
  launched: boolean;
  /** Outcome reviews scheduled and done. */
  reviewsDue: number;
  reviewsDone: number;
}

/**
 * The stage a plan is in. Pure; the order of the checks IS the definition.
 *
 * - CLOSED wins over everything: a closed plan stays closed until reopened.
 * - A private session is an IDEA whatever else is true of it.
 * - After release: LAUNCHING until the checklist is done, then MEASURING until
 *   every scheduled outcome review has run, then LEARNED.
 * - Before release: BUILDING once any build exists, READY once the design is
 *   approved, DESIGN once the PRD is ready, PRD once a lead holds it, FILED
 *   otherwise.
 */
export function derivePlanStage(facts: PlanStageFacts): PlanStage {
  if (facts.closed) return PlanStage.CLOSED;
  if (facts.private) return PlanStage.IDEA;
  if (facts.shipped) {
    if (!facts.launched) return PlanStage.LAUNCHING;
    if (facts.reviewsDue > 0 && facts.reviewsDone >= facts.reviewsDue) {
      return PlanStage.LEARNED;
    }
    return PlanStage.MEASURING;
  }
  if (facts.buildStarted) return PlanStage.BUILDING;
  if (facts.designApproved) return PlanStage.READY;
  if (facts.prdReady) return PlanStage.DESIGN;
  if (facts.leadUserId) return PlanStage.PRD;
  return PlanStage.FILED;
}

/** The stages a plan moves through, in order, for the progress bar. */
export const PLAN_PROGRESS: PlanStage[] = [
  PlanStage.IDEA,
  PlanStage.FILED,
  PlanStage.PRD,
  PlanStage.DESIGN,
  PlanStage.READY,
  PlanStage.BUILDING,
  PlanStage.LAUNCHING,
  PlanStage.MEASURING,
  PlanStage.LEARNED,
];

// ── Roadmap v2: one stage for every idea (plans/roadmap-builder-merge §2.2) ──

/**
 * The stage everyone sees. Five tracker steps (Submitted · Accepted · Planning
 * · Building · Shipped), Draft before them for its author only, and Declined
 * and Closed as terminal states that replace the tracker.
 */
export type ShownStage =
  | 'draft'
  | 'submitted'
  | 'accepted'
  | 'planning'
  | 'building'
  | 'shipped'
  | 'declined'
  | 'closed';

/** The tracker's five steps, in order (§4.9). */
export const ITEM_TRACKER: ShownStage[] = [
  'submitted',
  'accepted',
  'planning',
  'building',
  'shipped',
];

export type ItemCiState = 'passing' | 'failing' | 'pending' | 'unknown';

/**
 * Everything an idea's stage is derived from. Facts only, like PlanStageFacts:
 * the opportunity row, the plan session (absent for a legacy idea), and what
 * the read model knows about planning, building and shipping. The optional
 * groups default to "nothing known", which is never mistaken for progress.
 */
export interface ItemStageFacts {
  /** Null while the idea is a private draft with no opportunity row. */
  opportunity: {
    stage: 'new' | 'prioritised' | 'released' | 'archived';
    /** Null for a row nobody reviewed through Roadmap v2: read as accepted. */
    reviewState: 'pending' | 'accepted' | 'declined' | null;
    reviewedBy: number | null;
    reviewedAt: string | null;
    /** When it reached the board (the row's createdAt). */
    filedAt: string | null;
    votes: number;
    releasedAt: string | null;
  } | null;
  /** The plan session (`kind='plan'`). Null for an idea filed before plans existed. */
  plan:
    | (PlanStageFacts & {
        /**
         * Whether Start planning has been pressed (P3b). Undefined keeps rev
         * 5.2's meaning, where a lead taking the plan on starts the PRD.
         */
        planningStarted?: boolean;
        closedBy?: number | null;
        closedAt?: string | null;
        /** Draft readiness: the five checks. */
        checksMet?: number;
        checksTotal?: number;
      })
    | null;
  /**
   * A Builder session opened from a legacy idea ("Open in Builder"), for
   * ideas with no plan session. Ignored when `plan` is present.
   */
  legacySession?: { buildStarted: boolean } | null;
  planning?: {
    /** Share of the PRD readiness rubric met, 0–100. Null when unknown. */
    prdPercent: number | null;
    openQuestions: number;
    designAwaitingApproval: boolean;
  };
  build?: {
    /** Open in Claude Code was used (D18). */
    externalBuild: { byUserId: number; at: string } | null;
    repos: string[];
    openPrs: { number: number; ci: ItemCiState }[];
    mergedPrs: number;
    /** Merged and on its way to production. */
    releasing: boolean;
    /** Why a release waits for a click (D6), as a held-path id; null when not held. */
    heldReason: string | null;
  };
  shipped?: {
    liveSince: string | null;
    outcomeReviewAt: string | null;
    /** Null until an outcome review has run. */
    outcome: { hitTarget: boolean | null } | null;
  };
}

/**
 * The status line under the tracker, as data. Ids, counts and dates only:
 * the frontend writes the words (and resolves names), so every surface says
 * the same thing in the same copy. Never carries a decline reason, which only
 * the author may read — the read model adds it for them.
 */
export type ItemStatusParts =
  | { stage: 'draft'; checksMet: number; checksTotal: number }
  | { stage: 'submitted'; since: string | null; votes: number }
  | {
      stage: 'accepted';
      leadUserId: number | null;
      needsLead: boolean;
      votes: number;
    }
  | {
      stage: 'planning';
      step: 'prd' | 'design' | 'ready';
      leadUserId: number | null;
      prdPercent: number | null;
      openQuestions: number;
      designAwaitingApproval: boolean;
      /**
       * "Brief sent to Claude Code by … · waiting for a PR" (D18, §4.5b).
       * Null unless the brief was sent. The idea moves to Building in Claude
       * Code once a pull request exists.
       */
      externalBuild: { byUserId: number; at: string } | null;
    }
  | {
      stage: 'building';
      where: 'here' | 'claude_code';
      leadUserId: number | null;
      externalBuild: { byUserId: number; at: string } | null;
      repos: string[];
      openPrs: { number: number; ci: ItemCiState }[];
      mergedPrs: number;
      /**
       * Kept for the P2 contract; always false since P4. A brief sent with no
       * pull request yet is Planning with `externalBuild` set.
       */
      waitingForPr: boolean;
      releasing: boolean;
      heldReason: string | null;
    }
  | {
      stage: 'shipped';
      /** Null for a legacy idea with no plan to say how far measuring got. */
      step: 'launching' | 'measuring' | 'learned' | null;
      liveSince: string | null;
      outcomeReviewAt: string | null;
      outcome: { hitTarget: boolean | null } | null;
    }
  | { stage: 'declined'; byUserId: number | null; at: string | null }
  | {
      stage: 'closed';
      reason: 'not_pursuing' | 'archived';
      byUserId: number | null;
      at: string | null;
    };

export interface ItemStage {
  shownStage: ShownStage;
  statusParts: ItemStatusParts;
}

const PLANNING_STEP: Partial<Record<PlanStage, 'prd' | 'design' | 'ready'>> = {
  [PlanStage.PRD]: 'prd',
  [PlanStage.DESIGN]: 'design',
  [PlanStage.READY]: 'ready',
};

const SHIPPED_STEP: Partial<
  Record<PlanStage, 'launching' | 'measuring' | 'learned'>
> = {
  [PlanStage.LAUNCHING]: 'launching',
  [PlanStage.MEASURING]: 'measuring',
  [PlanStage.LEARNED]: 'learned',
};

/**
 * The stage an idea is shown in, and its status line. Pure; the order of the
 * checks IS the definition (§2.2):
 *
 * 1. No opportunity row → Draft (private, author only).
 * 2. Declined by the Owner → Declined, whatever else is true.
 * 3. Closed as not pursuing (plan) or archived (legacy stage) → Closed.
 * 4. Released, or the plan says shipped → Shipped.
 * 5. Awaiting the Owner's review → Submitted.
 * 6. Accepted (or never reviewed, which legacy rows are): Building once any
 *    build ran here, or once the brief went to Claude Code AND a pull request
 *    exists for the idea (P4, §4.5b); Planning once planning is under way, or
 *    the brief was sent and no pull request exists yet; Accepted otherwise.
 *
 * A legacy idea with no plan session is derived from `opportunity.stage` and
 * any Builder session opened from it. It never writes anything:
 * PlanStageService stays the only writer of the stage mirrors.
 */
export function deriveItemStage(facts: ItemStageFacts): ItemStage {
  const { opportunity, plan } = facts;
  const leadUserId = plan?.leadUserId ?? null;

  if (!opportunity) {
    return {
      shownStage: 'draft',
      statusParts: {
        stage: 'draft',
        checksMet: plan?.checksMet ?? 0,
        checksTotal: plan?.checksTotal ?? 0,
      },
    };
  }

  if (opportunity.reviewState === 'declined') {
    return {
      shownStage: 'declined',
      statusParts: {
        stage: 'declined',
        byUserId: opportunity.reviewedBy,
        at: opportunity.reviewedAt,
      },
    };
  }

  const planStage = plan ? derivePlanStage(plan) : null;

  if (planStage === PlanStage.CLOSED || opportunity.stage === 'archived') {
    const notPursuing = planStage === PlanStage.CLOSED;
    return {
      shownStage: 'closed',
      statusParts: {
        stage: 'closed',
        reason: notPursuing ? 'not_pursuing' : 'archived',
        byUserId: notPursuing ? (plan?.closedBy ?? null) : null,
        at: notPursuing ? (plan?.closedAt ?? null) : null,
      },
    };
  }

  if (
    opportunity.stage === 'released' ||
    (planStage !== null && SHIPPED_STEP[planStage] !== undefined)
  ) {
    return {
      shownStage: 'shipped',
      statusParts: {
        stage: 'shipped',
        // A plan that has not caught up with a release is launching.
        step: planStage ? (SHIPPED_STEP[planStage] ?? 'launching') : null,
        liveSince: facts.shipped?.liveSince ?? opportunity.releasedAt,
        outcomeReviewAt: facts.shipped?.outcomeReviewAt ?? null,
        outcome: facts.shipped?.outcome ?? null,
      },
    };
  }

  if (opportunity.reviewState === 'pending') {
    return {
      shownStage: 'submitted',
      statusParts: {
        stage: 'submitted',
        since: opportunity.filedAt,
        votes: opportunity.votes,
      },
    };
  }

  const externalBuild = facts.build?.externalBuild ?? null;
  const buildStarted = plan
    ? planStage === PlanStage.BUILDING
    : !!facts.legacySession?.buildStarted;
  const openPrs = facts.build?.openPrs ?? [];
  const mergedPrs = facts.build?.mergedPrs ?? 0;
  // Sent to Claude Code counts as building only once its work shows up as a
  // pull request: until then nothing is being built that anyone can see.
  const builtElsewhere =
    !!externalBuild && (openPrs.length > 0 || mergedPrs > 0);
  if (buildStarted || builtElsewhere) {
    const where = buildStarted ? 'here' : 'claude_code';
    return {
      shownStage: 'building',
      statusParts: {
        stage: 'building',
        where,
        leadUserId,
        externalBuild,
        repos: facts.build?.repos ?? [],
        openPrs,
        mergedPrs,
        waitingForPr: false,
        releasing: facts.build?.releasing ?? false,
        heldReason: facts.build?.heldReason ?? null,
      },
    };
  }

  const step =
    (plan
      ? planStage && plan.planningStarted !== false
        ? PLANNING_STEP[planStage]
        : undefined
      : facts.legacySession
        ? 'prd'
        : undefined) ??
    // The brief only goes out from Ready to build, so a sent brief with no
    // pull request yet is still that step.
    (externalBuild ? 'ready' : undefined);
  if (step) {
    return {
      shownStage: 'planning',
      statusParts: {
        stage: 'planning',
        step,
        leadUserId,
        prdPercent: facts.planning?.prdPercent ?? null,
        openQuestions: facts.planning?.openQuestions ?? 0,
        designAwaitingApproval: facts.planning?.designAwaitingApproval ?? false,
        externalBuild,
      },
    };
  }

  return {
    shownStage: 'accepted',
    statusParts: {
      stage: 'accepted',
      leadUserId,
      needsLead: leadUserId === null,
      votes: opportunity.votes,
    },
  };
}
