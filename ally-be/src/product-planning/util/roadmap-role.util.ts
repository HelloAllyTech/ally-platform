import type { ShownStage } from './plan-stage.util';

/**
 * Roadmap v2 roles (plans/roadmap-builder-merge D1, §3). Nested: Owner ⊃
 * Builder ⊃ Idea. Viewer is not grantable; it is what an org-restricted
 * platform admin with board access gets. None is no Roadmap at all.
 */
export type RoadmapRole = 'none' | 'viewer' | 'idea' | 'builder' | 'owner';

const RANK: Record<RoadmapRole, number> = {
  none: 0,
  viewer: 1,
  idea: 2,
  builder: 3,
  owner: 4,
};

/** True when `role` is at least `floor` (the roles nest). */
export function roleAtLeast(role: RoadmapRole, floor: RoadmapRole): boolean {
  return RANK[role] >= RANK[floor];
}

/**
 * What a person holds today, each half read the way the existing gate reads
 * it, so a role means exactly the access it replaces (§3.2, §3.3):
 * - `roadmap`: the `product_roadmap` toggle + VIEW_PRODUCT_ROADMAP (the board's guard);
 * - `builder`: the `builder` toggle + EDIT_BUILDER (assertBuilderAccess);
 * - `manage`: the `product_roadmap_manage` toggle + EDIT_PRODUCT_ROADMAP (the manage routes);
 * - `restricted`: an org-restricted platform admin (admin_tenants rows).
 */
export interface RoadmapGrants {
  roadmap: boolean;
  builder: boolean;
  manage: boolean;
  restricted: boolean;
}

/**
 * The day-one mapping (§3.3). The highest grant wins, because the roles nest:
 * a Builder without the Idea grant is not a state the new model has. An
 * org-restricted admin is a Viewer at most, whatever else they hold — the
 * Roadmap is platform-wide, and they see the board and vote but read no
 * transcripts, which is what they can do today.
 */
export function roleFromGrants(grants: RoadmapGrants): RoadmapRole {
  if (grants.restricted) {
    return grants.roadmap || grants.builder || grants.manage
      ? 'viewer'
      : 'none';
  }
  if (grants.manage) return 'owner';
  if (grants.builder) return 'builder';
  if (grants.roadmap) return 'idea';
  return 'none';
}

/** The caller's relationship to one idea. */
export interface RoadmapRelationship {
  isAuthor: boolean;
  isLead: boolean;
  isWatcher: boolean;
  /** The caller holds the plan interview right now (see `RoadmapCapabilityItem.planClaimed`). */
  holdsPlanClaim?: boolean;
}

/** The facts about one idea that decide what can be done to it. */
export interface RoadmapCapabilityItem {
  shownStage: ShownStage;
  /** The idea has a lead (builder_sessions.leadUserId). */
  hasLead: boolean;
  /** A plan session exists: there is a ceiling to raise and a session to plan in. */
  hasPlan: boolean;
  /** Start planning has been pressed (P3b). */
  planningStarted: boolean;
  /** Someone holds the plan interview: one person at a time. Legacy plans count their starter. */
  planClaimed?: boolean;
  /** The author handed the interview to the Owners, so the author may not take it again. */
  authorPassed?: boolean;
  /** The Owner closed the plan: planning is done and the idea can take a builder. */
  planClosed: boolean;
  /** A technical design is waiting for approval. */
  designAwaitingApproval: boolean;
  /** Planning has reached Ready to build. */
  readyToBuild: boolean;
  /** A pull request is green, reviewed and waiting for the lead's Merge. */
  awaitingMerge: boolean;
  /** A release is held for a click (D6). */
  releaseHeld: boolean;
  /** Agent-question answers conflict and wait for the settler (D13). */
  answersConflict: boolean;
}

/**
 * Every action the Roadmap UI may offer (§3.2, in §4.9's words). The server
 * computes it; the UI hides what is false rather than greying it out, which
 * is what fixes the 403-on-click gap.
 */
export interface RoadmapCapabilities {
  vote: boolean;
  comment: boolean;
  answer: boolean;
  watch: boolean;
  submit: boolean;
  review: boolean;
  pickLead: boolean;
  startPlanning: boolean;
  /** Continue a started plan interview nobody holds now (an Owner, or the author who has not handed it over). */
  takePlanning: boolean;
  /** Hand the interview back — the holder, before or part-way through. */
  releasePlanning: boolean;
  /** The author, before starting: ask the Owners to run the interview instead. */
  askOwnerToPlan: boolean;
  settleAnswer: boolean;
  approveDesign: boolean;
  startBuild: boolean;
  merge: boolean;
  release: boolean;
  raiseCeiling: boolean;
  close: boolean;
  configure: boolean;
  star: boolean;
  pinView: boolean;
  exportBrief: boolean;
  /** Decline at any point before Released (the Owner's call). */
  decline: boolean;
  /** Close the plan, so a builder can be assigned (the Owner). */
  closePlan: boolean;
  /** Reopen a closed plan while nobody builds it yet (the Owner). */
  reopenPlan: boolean;
  /** Say how it is built: Builder agent or outside it (the assigned builder, or an Owner). */
  setBuildMode: boolean;
  /** Mark it Released (the assigned builder, or an Owner). */
  markReleased: boolean;
  /**
   * Work the plan from the idea page (audit 2026-11-19, rec 1): send the
   * planning agent a message, edit the PRD, dismiss a review finding and draft
   * the technical design. An Owner, or the builder already assigned to it,
   * while it is being planned and the plan is not closed.
   */
  workPlan: boolean;
}

export const NO_CAPABILITIES: RoadmapCapabilities = Object.freeze({
  vote: false,
  comment: false,
  answer: false,
  watch: false,
  submit: false,
  review: false,
  pickLead: false,
  startPlanning: false,
  takePlanning: false,
  releasePlanning: false,
  askOwnerToPlan: false,
  settleAnswer: false,
  approveDesign: false,
  startBuild: false,
  merge: false,
  release: false,
  raiseCeiling: false,
  close: false,
  configure: false,
  star: false,
  pinView: false,
  exportBrief: false,
  decline: false,
  closePlan: false,
  reopenPlan: false,
  setBuildMode: false,
  markReleased: false,
  workPlan: false,
});

/** What the caller can do anywhere, with no idea in view (the `me/role` answer). */
export function globalCapabilities(
  role: RoadmapRole,
): Pick<RoadmapCapabilities, 'configure' | 'pinView' | 'review' | 'submit'> {
  const owner = role === 'owner';
  return {
    configure: owner,
    pinView: owner,
    review: owner,
    submit: roleAtLeast(role, 'idea'),
  };
}

/**
 * What one person may do to one idea: role, plus relationship, plus the
 * idea's state. Pure. The lifecycle (Sandeep, 2026-11-18):
 *
 * - Idea ⊂ Builder ⊂ Owner. Anyone with Idea or above drafts privately and
 *   submits once the draft is ready; every submitted idea is open to everyone
 *   to read and comment on, and to vote on (their own included) while it is
 *   in To do.
 * - Submitting puts it in To do (Backlog). From then on only an Owner edits it.
 * - An Owner expands it into a plan (Start planning accepts an idea that was
 *   waiting for review), works the plan, and closes the plan. The idea's author
 *   (with the Idea role) may take the plan interview too, but it has one holder
 *   at a time: while someone holds it nobody else is offered it, and the holder
 *   can hand it back before or part-way through. An author who hands it to the
 *   Owners cannot take it again. Only an Owner closes the plan.
 * - Only once the plan is closed does an Owner assign a builder; assigning one
 *   is what moves it to Being built. An Owner can change the builder.
 * - After that the assigned builder leads it: how it is built (Builder agent or
 *   outside), the build calls, and marking it Released. An Owner can do all of
 *   that too. Released is only ever a person's click.
 * - Declining is the Owner's, at any point before Released.
 * - Declined and Closed ideas are read-only for everyone (§4.7).
 */
export function capabilitiesFor(
  role: RoadmapRole,
  rel: RoadmapRelationship,
  item: RoadmapCapabilityItem,
): RoadmapCapabilities {
  if (role === 'none') return { ...NO_CAPABILITIES };

  const owner = role === 'owner';
  const builder = roleAtLeast(role, 'builder');
  const idea = roleAtLeast(role, 'idea');
  const stage = item.shownStage;
  const draft = stage === 'draft';
  const terminal = stage === 'declined' || stage === 'closed';
  const shared = !draft;
  const live = shared && !terminal;
  const open = live && stage !== 'shipped';
  // To do: submitted, accepted or being planned, with nobody assigned to build it.
  const toDo =
    !item.hasLead &&
    (stage === 'submitted' || stage === 'accepted' || stage === 'planning');
  // The builder's calls: the assigned builder on their idea, or any Owner.
  const leads = owner || (builder && rel.isLead);
  // Build-side calls need someone assigned to build it.
  const builds = item.hasLead && leads;
  // The plan interview has one holder at a time. An Owner may always take a free one; the
  // idea's author may too, until they hand it to the Owners.
  const claimed = item.planClaimed === true;
  const holds = rel.holdsPlanClaim === true && claimed;
  const authorMay = idea && rel.isAuthor && item.authorPassed !== true;
  const planOpen =
    !item.hasLead &&
    !item.planClosed &&
    (stage === 'submitted' || stage === 'accepted' || stage === 'planning');
  const canClaim = planOpen && !claimed && (owner || authorMay);

  return {
    // Votes are open while it is in To do: once a builder is assigned they lock, and the votes
    // already cast stay (RoadmapAllocationService.lockedReason says the same).
    vote: open && !item.hasLead && stage !== 'building',
    comment: live,
    answer: draft ? idea && rel.isAuthor : live && idea,
    watch: shared && idea,
    submit: draft && idea && rel.isAuthor,
    review: owner && stage === 'submitted',
    decline: owner && open,
    // Assign (or change) the builder: only once the plan is closed. An idea
    // that already has a builder (assigned before plans closed) can always be
    // handed to another.
    pickLead: owner && open && (item.planClosed || item.hasLead),
    startPlanning:
      canClaim &&
      (stage === 'submitted' || stage === 'accepted') &&
      !item.planningStarted,
    takePlanning: canClaim && item.planningStarted,
    releasePlanning: holds && planOpen && item.planningStarted,
    askOwnerToPlan:
      authorMay &&
      !owner &&
      planOpen &&
      !claimed &&
      !item.planningStarted &&
      (stage === 'submitted' || stage === 'accepted'),
    closePlan: owner && toDo && stage === 'planning' && !item.planClosed,
    reopenPlan: owner && toDo && item.planClosed,
    settleAnswer:
      live &&
      item.answersConflict &&
      (owner ||
        (builder && rel.isLead) ||
        (!item.hasLead && idea && rel.isAuthor)),
    approveDesign: stage === 'planning' && item.designAwaitingApproval && leads,
    startBuild: stage === 'planning' && item.readyToBuild && builds,
    merge: stage === 'building' && item.awaitingMerge && builds,
    release: live && item.releaseHeld && leads,
    raiseCeiling: live && item.hasPlan && leads,
    close: owner && open,
    configure: owner,
    star: live && owner,
    pinView: owner,
    exportBrief: builds && (stage === 'planning' || stage === 'building'),
    setBuildMode: builds && (stage === 'planning' || stage === 'building'),
    markReleased:
      open &&
      stage !== 'submitted' &&
      (owner || (builder && rel.isLead && item.hasLead)),
    // Closing the plan ends planning: reopen it to change the PRD again.
    // Held by someone: only the holder works it. Not held (older plans): an Owner or the builder.
    // (An author's interview on an idea still awaiting review runs in the submitted stage.)
    workPlan:
      (stage === 'planning' || (stage === 'submitted' && claimed)) &&
      item.planningStarted &&
      !item.planClosed &&
      (claimed ? holds : leads),
  };
}

/** The inline edits on the idea page (§4.11), one flag per field. */
export interface RoadmapEditCapabilities {
  editTitle: boolean;
  editGoal: boolean;
  editSummary: boolean;
  editLead: boolean;
  editMonth: boolean;
  editSize: boolean;
}

/**
 * Who may edit which field in place (§4.11). Pure.
 *
 * - Once submitted, only an Owner edits an idea: title, goal and summary
 *   (lifecycle 2026-11-18; the author edits it freely while it is a draft,
 *   on the draft page).
 * - Lead: an Owner, once the plan is closed or a builder is already
 *   assigned. Planned month: an Owner. The month stops being editable once
 *   the idea ships, because a shipped idea sits in the month it shipped.
 * - Size: an Owner, at any open stage (a shipped idea can still be sized for
 *   the record).
 * - Declined and Closed ideas are read-only (§4.7), and a draft is edited on
 *   its own page, not here.
 */
export function editCapabilitiesFor(
  role: RoadmapRole,
  rel: Pick<RoadmapRelationship, 'isAuthor' | 'isLead'>,
  stage: ShownStage,
  plan: { planClosed: boolean; hasLead: boolean } = {
    planClosed: false,
    hasLead: false,
  },
): RoadmapEditCapabilities {
  const owner = role === 'owner';
  const open =
    roleAtLeast(role, 'idea') &&
    stage !== 'draft' &&
    stage !== 'declined' &&
    stage !== 'closed';
  const text = open && owner;
  return {
    editTitle: text,
    editGoal: text,
    editSummary: text,
    editLead:
      open && owner && stage !== 'shipped' && (plan.planClosed || plan.hasLead),
    editMonth: open && owner && stage !== 'shipped',
    editSize: text,
  };
}
