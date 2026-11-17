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
 * idea's state, following the §3.1 matrix and D10–D18. Pure.
 *
 * - Shared ideas are open to everyone with board access to vote and comment
 *   (D12, D17); a draft is its author's alone.
 * - Declined and Closed ideas are read-only for everyone (§4.7).
 * - The lead's build-side calls belong to the lead (a Builder) on their idea
 *   and to any Owner on any idea (D4, D11, §2.1a).
 * - Review, picking the lead, the star, saved-view pins and configuration are
 *   the Owner's (D10, D11, D16, D15).
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
  // The lead's calls: their own idea as a Builder, or any idea as an Owner.
  const leads = owner || (builder && rel.isLead);

  return {
    vote: live && stage !== 'shipped',
    comment: live,
    answer: draft ? idea && rel.isAuthor : live && idea,
    watch: shared && idea,
    submit: draft && idea && rel.isAuthor,
    review: owner && stage === 'submitted',
    pickLead:
      owner &&
      (stage === 'accepted' || stage === 'planning' || stage === 'building'),
    startPlanning:
      stage === 'accepted' &&
      !item.planningStarted &&
      (owner || (builder && rel.isLead)),
    settleAnswer:
      live &&
      item.answersConflict &&
      (owner ||
        (builder && rel.isLead) ||
        (!item.hasLead && idea && rel.isAuthor)),
    approveDesign: stage === 'planning' && item.designAwaitingApproval && leads,
    startBuild: stage === 'planning' && item.readyToBuild && leads,
    merge: stage === 'building' && item.awaitingMerge && leads,
    release: live && item.releaseHeld && leads,
    raiseCeiling: live && item.hasPlan && leads,
    close: live && stage !== 'shipped' && builder,
    configure: owner,
    star: live && owner,
    pinView: owner,
    exportBrief:
      (stage === 'planning' && item.readyToBuild) || stage === 'building'
        ? leads
        : false,
  };
}
