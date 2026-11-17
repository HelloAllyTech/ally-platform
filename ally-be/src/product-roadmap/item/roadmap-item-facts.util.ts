import { PlanStage } from 'src/product-planning/enum/product-planning.enum';
import type {
  ItemCiState,
  ItemStage,
  ItemStageFacts,
  PlanStageFacts,
} from 'src/product-planning/util/plan-stage.util';

/**
 * Pure helpers that turn loaded rows into the facts `deriveItemStage` reads,
 * for the queue's rows. The idea page derives from the full facts instead
 * (PlanStageService.facts); a row reads the two expensive facts — PRD ready
 * and design approved — from the stage mirror PlanStageService writes, as
 * §5.3 says the board does, so a list never runs a readiness check per row.
 */

/** Session statuses that mean a build has run (as PlanStageService reads them). */
export const BUILD_STARTED_STATUSES = [
  'BUILDING',
  'WAITING_FOR_INPUT',
  'COMPLETED',
  'FAILED',
];

const PRD_READY_STAGES: string[] = [
  PlanStage.DESIGN,
  PlanStage.READY,
  PlanStage.BUILDING,
  PlanStage.LAUNCHING,
  PlanStage.MEASURING,
  PlanStage.LEARNED,
];
const DESIGN_APPROVED_STAGES: string[] = PRD_READY_STAGES.filter(
  (s) => s !== PlanStage.DESIGN,
);

/** The session columns a row reads (raw SQL, so loose types). */
export interface SessionFacts {
  id: string;
  kind: string;
  status: string;
  visibility: string;
  createdBy: number;
  leadUserId: number | null;
  planStage: string | null;
  planStageAt: string | null;
  updatedAt: string | null;
  lastRunSequence: number;
  repos: string[];
  closed: {
    at?: string;
    by?: number;
    pendingConfirmation?: boolean;
  } | null;
  launchedAt: string | null;
  reviews: { dueDates?: string[]; done?: number } | null;
  externalBuild: { byUserId?: number; at?: string } | null;
  planningStarted: boolean | null;
  totalCostUsd: number;
  budgetUsd: number | null;
}

export interface OpportunityFacts {
  stage: string;
  reviewState: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  releasedAt: string | null;
  votes: number;
}

export interface PrFact {
  repo: string;
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
  ci: ItemCiState;
}

export interface ReleaseFact {
  repo: string;
  prNumber: number;
  service: string;
  state: 'pending' | 'live' | 'failed';
  tag: string | null;
  releasedAt: string | null;
}

export interface PlanningFacts {
  prdPercent: number | null;
  openQuestions: number;
  designAwaitingApproval: boolean;
}

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export { iso as toIso };

/** GitHub's check rollup in the tracker's words. */
export function ciState(raw: string | null | undefined): ItemCiState {
  if (raw === 'success') return 'passing';
  if (raw === 'failure' || raw === 'error') return 'failing';
  if (raw === 'pending') return 'pending';
  return 'unknown';
}

/** "owner/ally-platform" and "ally-platform" are the same repo here. */
export const repoKey = (repo: string, number: number) =>
  `${repo.split('/').pop()?.toLowerCase() ?? repo}#${number}`;

/**
 * Builder's pull requests and P1's linked ones, one per repo and number.
 * Builder's row wins: it carries the CI rollup.
 */
export function mergePrs(builder: PrFact[], linked: PrFact[]): PrFact[] {
  const out = new Map<string, PrFact>();
  for (const pr of [...builder, ...linked]) {
    const key = repoKey(pr.repo, pr.number);
    if (!out.has(key)) out.set(key, pr);
  }
  return [...out.values()];
}

/** The plan's stage facts, with PRD and design read from the stage mirror. */
export function mirrorPlanFacts(
  session: SessionFacts,
  opportunityReleased: boolean,
): PlanStageFacts {
  const stage = session.planStage ?? '';
  return {
    private: session.visibility === 'private',
    closed: !!session.closed && !session.closed.pendingConfirmation,
    leadUserId: session.leadUserId ?? null,
    prdReady: PRD_READY_STAGES.includes(stage),
    designApproved: DESIGN_APPROVED_STAGES.includes(stage),
    buildStarted: buildStarted(session),
    shipped: opportunityReleased,
    launched: !!session.launchedAt,
    reviewsDue: session.reviews?.dueDates?.length ?? 0,
    reviewsDone: session.reviews?.done ?? 0,
  };
}

export function buildStarted(session: SessionFacts): boolean {
  return (
    (session.lastRunSequence ?? 0) > 0 ||
    BUILD_STARTED_STATUSES.includes(session.status)
  );
}

/**
 * Everything deriveItemStage reads, from loaded rows. `planFacts` overrides
 * the mirror when the caller has the real ones (the idea page).
 */
export function itemStageFacts(input: {
  opportunity: OpportunityFacts;
  session: SessionFacts | null;
  planFacts?: PlanStageFacts | null;
  planning: PlanningFacts;
  prs: PrFact[];
  releases: ReleaseFact[];
}): ItemStageFacts {
  const { opportunity: o, session } = input;
  const released = o.stage === 'released';
  const isPlan = session?.kind === 'plan';
  const reviewState =
    o.reviewState === 'pending' ||
    o.reviewState === 'accepted' ||
    o.reviewState === 'declined'
      ? o.reviewState
      : null;
  const stage = (
    ['new', 'prioritised', 'released', 'archived'].includes(o.stage)
      ? o.stage
      : 'new'
  ) as 'new' | 'prioritised' | 'released' | 'archived';
  const merged = input.prs.filter((pr) => pr.state === 'merged');
  const live = input.releases
    .filter((r) => r.state === 'live' && r.releasedAt)
    .map((r) => r.releasedAt as string)
    .sort();
  const reviews = session?.reviews;
  const doneReviews = reviews?.done ?? 0;
  const externalBuild =
    session?.externalBuild?.byUserId && session.externalBuild.at
      ? {
          byUserId: Number(session.externalBuild.byUserId),
          at: String(session.externalBuild.at),
        }
      : null;

  return {
    opportunity: {
      stage,
      reviewState,
      reviewedBy: o.reviewedBy,
      reviewedAt: iso(o.reviewedAt),
      filedAt: iso(o.createdAt),
      votes: o.votes,
      releasedAt: iso(o.releasedAt),
    },
    plan:
      isPlan && session
        ? {
            ...(input.planFacts ?? mirrorPlanFacts(session, released)),
            ...(session.planningStarted !== null
              ? { planningStarted: session.planningStarted }
              : {}),
            closedBy: session.closed?.by ?? null,
            closedAt: iso(session.closed?.at),
          }
        : null,
    legacySession:
      session && !isPlan ? { buildStarted: buildStarted(session) } : null,
    planning: input.planning,
    build: {
      externalBuild,
      repos: session?.repos ?? [],
      openPrs: input.prs
        .filter((pr) => pr.state === 'open')
        .map((pr) => ({ number: pr.number, ci: pr.ci })),
      mergedPrs: merged.length,
      releasing:
        !released &&
        merged.length > 0 &&
        input.releases.some((r) => r.state === 'pending'),
      heldReason: null,
    },
    shipped: {
      liveSince: iso(o.releasedAt) ?? live[live.length - 1] ?? null,
      outcomeReviewAt: reviews?.dueDates?.[doneReviews] ?? null,
      outcome: null,
    },
  };
}

/** When the idea entered the stage it is shown in. */
export function stageSinceOf(
  stage: ItemStage,
  o: OpportunityFacts & { updatedAt: string; planStageAt?: string | null },
  session: SessionFacts | null,
): string {
  const created = iso(o.createdAt) ?? new Date(0).toISOString();
  const reviewed = iso(o.reviewedAt);
  switch (stage.shownStage) {
    case 'accepted':
      return reviewed ?? created;
    case 'planning':
    case 'building':
      return (
        iso(session?.planStageAt) ?? iso(o.planStageAt) ?? reviewed ?? created
      );
    case 'shipped': {
      const parts = stage.statusParts;
      return (
        (parts.stage === 'shipped' ? parts.liveSince : null) ??
        iso(o.updatedAt) ??
        created
      );
    }
    case 'declined':
      return reviewed ?? created;
    case 'closed': {
      const parts = stage.statusParts;
      return (
        (parts.stage === 'closed' ? parts.at : null) ??
        iso(o.updatedAt) ??
        created
      );
    }
    default:
      return created;
  }
}

/** The latest of several instants, as ISO; the epoch when none parse. */
export function latest(...values: unknown[]): string {
  const times = values
    .map((v) => iso(v))
    .filter((v): v is string => !!v)
    .sort();
  return times[times.length - 1] ?? new Date(0).toISOString();
}
