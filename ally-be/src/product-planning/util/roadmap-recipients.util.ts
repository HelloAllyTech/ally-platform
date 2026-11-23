import { BuilderNotificationKind } from 'src/builder/enum/builder.enum';
import {
  PlanNotificationKind,
  RoadmapNotificationKind,
  RoadmapWatchLevel,
} from '../enum/product-planning.enum';

/** Who an event goes to, by column of the §4.8 table. */
interface Audience {
  /** The author: always, never, or only while the idea has no lead. */
  author: 'yes' | 'before_lead' | 'no';
  /** Watchers on All. */
  watchAll: boolean;
  /** Voters and watchers on Milestones (and so watchers on All too). */
  milestones: boolean;
  lead: boolean;
  owners: boolean;
}

const none: Audience = {
  author: 'no',
  watchAll: false,
  milestones: false,
  lead: false,
  owners: false,
};

/**
 * plans/roadmap-builder-merge §4.8, one row per event. `mention` and
 * `activity` go only to the people the writer names. `budget` (a ceiling
 * reached, §4.7) goes to the two people who can raise it: the lead and Owners.
 */
export const ROADMAP_AUDIENCE: Record<RoadmapNotificationKind, Audience> = {
  [RoadmapNotificationKind.SUBMITTED]: { ...none, owners: true },
  [RoadmapNotificationKind.ACCEPTED]: {
    ...none,
    author: 'yes',
    watchAll: true,
    milestones: true,
  },
  [RoadmapNotificationKind.DECLINED]: {
    ...none,
    author: 'yes',
    watchAll: true,
    milestones: true,
  },
  [RoadmapNotificationKind.LEAD_ASSIGNED]: {
    ...none,
    author: 'yes',
    watchAll: true,
    milestones: true,
  },
  [RoadmapNotificationKind.ASSIGNED_TO_YOU]: {
    ...none,
    lead: true,
    owners: true,
  },
  [RoadmapNotificationKind.HANDED_BACK]: { ...none, lead: true, owners: true },
  [RoadmapNotificationKind.AGENT_QUESTION]: {
    ...none,
    author: 'yes',
    watchAll: true,
    lead: true,
  },
  [RoadmapNotificationKind.MENTION]: none,
  [RoadmapNotificationKind.ANSWERS_CONFLICT]: {
    ...none,
    author: 'before_lead',
    lead: true,
  },
  [RoadmapNotificationKind.DECISION_NEEDED]: { ...none, lead: true },
  [RoadmapNotificationKind.SHIPPED]: {
    ...none,
    author: 'yes',
    watchAll: true,
    milestones: true,
    lead: true,
  },
  [RoadmapNotificationKind.OUTCOME_REVIEWED]: {
    ...none,
    author: 'yes',
    watchAll: true,
    milestones: true,
    lead: true,
  },
  [RoadmapNotificationKind.RELEASE_HELD]: { ...none, lead: true, owners: true },
  [RoadmapNotificationKind.RELEASE_FAILED]: {
    ...none,
    lead: true,
    owners: true,
  },
  [RoadmapNotificationKind.BREAKER_OPEN]: { ...none, lead: true, owners: true },
  [RoadmapNotificationKind.BUDGET]: { ...none, lead: true, owners: true },
  [RoadmapNotificationKind.ACTIVITY]: none,
  // Idea-to-plan audit rec 8: the plan is there to read before it closes, and
  // it closing is a milestone for everyone who follows the idea.
  [RoadmapNotificationKind.PLAN_READY]: {
    ...none,
    author: 'yes',
    watchAll: true,
    milestones: true,
    lead: true,
  },
  [RoadmapNotificationKind.PLAN_CLOSED]: {
    ...none,
    author: 'yes',
    watchAll: true,
    milestones: true,
  },
  // Comments go to people following on All (the author and the lead or
  // planner by default); Milestones and None are respected.
  [RoadmapNotificationKind.COMMENT]: { ...none, watchAll: true },
  [RoadmapNotificationKind.QUESTION_ANSWERED]: { ...none, lead: true },
  // Told to the author alone (direct), so it needs no audience of its own.
  [RoadmapNotificationKind.PLAN_OFFERED]: none,
  [RoadmapNotificationKind.PLAN_HANDED_OVER]: { ...none, owners: true },
};

/** The facts the rules read about one idea. */
export interface RecipientFacts {
  authorUserId: number | null;
  leadUserId: number | null;
  /**
   * The Owner who pressed Start planning (`plan.planningStartedBy`), while
   * nobody leads the idea: they get the lead's column and its default watch
   * (idea-to-plan audit rec 8). Once a builder leads it, the lead does.
   */
  plannerUserId?: number | null;
  ownerIds: number[];
  voterIds: number[];
  watches: { userId: number; level: RoadmapWatchLevel }[];
  /**
   * People the writer names: the original recipient of a dual-written notice,
   * or the person @mentioned. Always included, so dual-writing never loses
   * anyone the old table would have told.
   */
  directRecipientIds?: number[];
  /** Whoever caused it; never told about their own action. */
  actorUserId?: number | null;
}

/**
 * A person's watch level on an idea: their row, or the default for how they
 * relate to it (§4.8: authors and leads start on All; voting means
 * Milestones).
 */
export function effectiveWatchLevel(
  userId: number,
  facts: Pick<
    RecipientFacts,
    'authorUserId' | 'leadUserId' | 'voterIds' | 'watches' | 'plannerUserId'
  >,
): RoadmapWatchLevel {
  const row = facts.watches.find((w) => w.userId === userId);
  if (row) return row.level;
  if (
    userId === facts.authorUserId ||
    userId === facts.leadUserId ||
    userId === activePlanner(facts)
  ) {
    return RoadmapWatchLevel.ALL;
  }
  if (facts.voterIds.includes(userId)) return RoadmapWatchLevel.MILESTONES;
  return RoadmapWatchLevel.NONE;
}

/** The planner while nobody leads the idea; null otherwise. */
export function activePlanner(
  facts: Pick<RecipientFacts, 'leadUserId' | 'plannerUserId'>,
): number | null {
  return facts.leadUserId ? null : (facts.plannerUserId ?? null);
}

/**
 * Who hears about this event (§4.8). Pure. The role columns (author, lead,
 * Owners) always apply; watch levels decide who else does, and a watch of
 * None only stops watcher delivery. Deduplicated and sorted.
 */
export function recipientsFor(
  kind: RoadmapNotificationKind,
  facts: RecipientFacts,
): number[] {
  const audience = ROADMAP_AUDIENCE[kind];
  const out = new Set<number>(facts.directRecipientIds ?? []);
  const add = (id: number | null | undefined) => {
    if (id) out.add(id);
  };

  if (
    audience.author === 'yes' ||
    (audience.author === 'before_lead' && !facts.leadUserId)
  ) {
    add(facts.authorUserId);
  }
  if (audience.lead) {
    add(facts.leadUserId);
    add(activePlanner(facts));
  }
  if (audience.owners) facts.ownerIds.forEach(add);

  if (audience.watchAll || audience.milestones) {
    const people = new Set<number>([
      ...facts.watches.map((w) => w.userId),
      ...facts.voterIds,
      ...[facts.authorUserId, facts.leadUserId, activePlanner(facts)].filter(
        (id): id is number => !!id,
      ),
    ]);
    for (const userId of people) {
      const level = effectiveWatchLevel(userId, facts);
      if (level === RoadmapWatchLevel.ALL) add(userId);
      else if (level === RoadmapWatchLevel.MILESTONES && audience.milestones)
        add(userId);
    }
  }

  if (facts.actorUserId) out.delete(facts.actorUserId);
  return [...out].sort((a, b) => a - b);
}

/** Ten minutes: notices about one idea and kind inside one window collapse. */
export const ROADMAP_NOTIFICATION_GROUP_WINDOW_MS = 10 * 60 * 1000;

export function roadmapGroupKey(
  kind: RoadmapNotificationKind,
  scope: { itemId?: string | null; sessionId?: string | null },
  at: Date,
): string {
  const where = scope.itemId
    ? `item:${scope.itemId}`
    : scope.sessionId
      ? `session:${scope.sessionId}`
      : 'none';
  const bucket = Math.floor(
    at.getTime() / ROADMAP_NOTIFICATION_GROUP_WINDOW_MS,
  );
  return `${where}:${kind}:${bucket}`;
}

/** How an old Builder notice maps onto the new stream (dual-write). */
export function kindForBuilderNotification(
  kind: BuilderNotificationKind,
): RoadmapNotificationKind {
  switch (kind) {
    case BuilderNotificationKind.QUESTION_PENDING:
      return RoadmapNotificationKind.AGENT_QUESTION;
    case BuilderNotificationKind.PR_READY_TO_MERGE:
      return RoadmapNotificationKind.DECISION_NEEDED;
    case BuilderNotificationKind.BUDGET_REACHED:
      return RoadmapNotificationKind.BUDGET;
    case BuilderNotificationKind.RELEASE_FAILED:
      return RoadmapNotificationKind.RELEASE_FAILED;
    case BuilderNotificationKind.RELEASE_SKIPPED:
      return RoadmapNotificationKind.RELEASE_HELD;
    default:
      return RoadmapNotificationKind.ACTIVITY;
  }
}

/** How an old plan notice maps onto the new stream (dual-write). */
export function kindForPlanNotification(
  kind: PlanNotificationKind,
): RoadmapNotificationKind {
  switch (kind) {
    case PlanNotificationKind.TAKEN_ON:
      return RoadmapNotificationKind.LEAD_ASSIGNED;
    case PlanNotificationKind.HANDED_BACK:
    case PlanNotificationKind.AUTO_RELEASED:
      return RoadmapNotificationKind.HANDED_BACK;
    case PlanNotificationKind.LAUNCHED:
      return RoadmapNotificationKind.SHIPPED;
    case PlanNotificationKind.OUTCOME:
      return RoadmapNotificationKind.OUTCOME_REVIEWED;
    case PlanNotificationKind.CEILING_WARNING:
      return RoadmapNotificationKind.BUDGET;
    default:
      return RoadmapNotificationKind.ACTIVITY;
  }
}
