/**
 * The decision feed: every point, across every Builder session, where the
 * agent has stopped and is waiting for a person to choose.
 *
 * Builder's decisions used to live wherever they were raised — an interview
 * question inline in one session's chat, a merge button in a Slack message, a
 * stopped build on mission control, a budget banner on the session page. Each
 * one is a page visit and a context rebuild, and across a dozen concurrent
 * sessions that cost is what bounds how much Builder can do. The feed folds
 * them into one shape so a person can clear them in one sitting, one key
 * each, without opening a session.
 *
 * Nothing here is stored. A decision is *derived* from the state that already
 * records it (an unanswered question on the last assistant row, a pull
 * request with `mergePromptedAt` set and `merged` false), and answering one
 * goes through the same service call the session page would have made. That
 * is deliberate: a second table of "pending decisions" would have to be kept
 * in step with the truth it summarises, and the first time it drifted the feed
 * would be asking about a question somebody had already answered elsewhere.
 */

/**
 * What kind of thing is being decided. The id of a decision starts with its
 * kind, so the answer endpoint routes on it without a lookup table.
 */
export type BuilderDecisionKind =
  /** An `ask_admin` question from the PRD interview. */
  | 'question'
  /** The interview's opening situation brief, awaiting confirmation. */
  | 'brief'
  /** The PRD is ready: start the build, or draft the design first. */
  | 'start_build'
  /** A technical design in review, awaiting approval. */
  | 'design_review'
  /** A session that has spent its ceiling and is holding its work. */
  | 'budget'
  /** A pull request Builder's fix loop has handed to a person. */
  | 'pr_needs_human'
  /** A green, reviewed, approved pull request with only the merge left. */
  | 'pr_merge'
  /** A build that stopped and is waiting to be retried or closed. */
  | 'build_failed';

/**
 * The three questions a person is actually being asked, whatever the kind:
 * what to build, how to build it, or how to get something unstuck. The feed
 * filters on this, because a product owner clearing scope questions and an
 * engineer clearing stuck pull requests are different sittings.
 */
export type BuilderDecisionCategory = 'what' | 'how' | 'issue';

export interface BuilderDecisionOption {
  id: string;
  label: string;
  /** The trade-off, in one line. What makes an option pickable at a glance. */
  description?: string;
  /** At most one per decision; the feed answers it on Enter. */
  recommended?: boolean;
}

export interface BuilderDecision {
  /** `<kind>:<sessionId>` or `<kind>:<sessionId>:<ref>` — see `parseDecisionId`. */
  id: string;
  kind: BuilderDecisionKind;
  category: BuilderDecisionCategory;
  sessionId: string;
  sessionTitle: string;
  sessionStatus: string;
  /** Display name of whoever started the session; null if the user is gone. */
  createdByName: string | null;
  repos: string[];
  /** The question itself, or the headline of the situation. */
  prompt: string;
  /**
   * Why this is being asked — for a gated interview question, the model's
   * rationale followed by `Based on:` and `Yours to decide because:` lines.
   */
  rationale: string | null;
  /** scope / behaviour / priority / taste / contradiction, where the question named one. */
  questionType: string | null;
  /** Short lines of context a person needs before choosing: the PRD summary, spend, the error. */
  context: string[];
  /** One line: what cannot move until this is decided. */
  blocked: string;
  selection: 'single' | 'multi';
  options: BuilderDecisionOption[];
  /** Whether a free-text answer is accepted alongside (or instead of) the options. */
  allowCustom: boolean;
  allowNone: boolean;
  minSelections: number | null;
  /** Placeholder for the free-text entry, saying what the words will be used for. */
  customPlaceholder: string | null;
  /** When the agent started waiting — the feed orders oldest-first within a kind. */
  waitingSince: string;
  pullRequestUrl: string | null;
}

/** What the answer endpoint did with an answer. */
export type BuilderDecisionOutcome =
  /** An interview turn is running in the background with the answer. */
  | 'turn_started'
  | 'build_started'
  | 'design_started'
  | 'design_approved'
  | 'budget_raised'
  | 'merged'
  | 'resumed'
  | 'archived'
  | 'cancelled';

export interface BuilderDecisionAnswerResult {
  ok: true;
  outcome: BuilderDecisionOutcome;
}

/** Decision kinds and their category. */
export const BUILDER_DECISION_CATEGORY: Record<
  BuilderDecisionKind,
  BuilderDecisionCategory
> = {
  question: 'what',
  brief: 'what',
  start_build: 'what',
  design_review: 'how',
  budget: 'issue',
  pr_needs_human: 'issue',
  pr_merge: 'issue',
  build_failed: 'issue',
};

export const BUILDER_DECISION_KINDS = Object.keys(
  BUILDER_DECISION_CATEGORY,
) as BuilderDecisionKind[];

export const buildDecisionId = (
  kind: BuilderDecisionKind,
  sessionId: string,
  ref?: string | null,
): string => (ref ? `${kind}:${sessionId}:${ref}` : `${kind}:${sessionId}`);

/**
 * The inverse of `buildDecisionId`. Null for anything that is not one — the
 * answer endpoint turns that into a 400 rather than guessing.
 */
export const parseDecisionId = (
  id: string,
): {
  kind: BuilderDecisionKind;
  sessionId: string;
  ref: string | null;
} | null => {
  const [kind, sessionId, ...rest] = String(id ?? '').split(':');
  if (!BUILDER_DECISION_KINDS.includes(kind as BuilderDecisionKind))
    return null;
  if (!sessionId) return null;
  return {
    kind: kind as BuilderDecisionKind,
    sessionId,
    ref: rest.length ? rest.join(':') : null,
  };
};
