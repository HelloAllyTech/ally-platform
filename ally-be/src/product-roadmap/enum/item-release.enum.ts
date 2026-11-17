/**
 * Value sets for release tracking (`item_linked_prs`, `item_releases`). Stored as
 * `character varying` with CHECK constraints, per ally-be convention.
 */

/** How a pull request came to be linked to an opportunity. */
export enum ItemLinkSource {
  /** Opened by the opportunity's Builder session (`builder_pull_requests`). */
  BUILDER = 'builder',
  /**
   * Its title or branch name carries the opportunity's code (`OPP-0388`).
   * Recorded, but on its own never releases anything: multi-PR features are
   * built slice by slice under one code, and the first slice going live is
   * not the feature shipping (see `linkDrivesRelease`).
   */
  CODE_MATCH = 'code_match',
  /** Linked by hand: "Built elsewhere". */
  MANUAL = 'manual',
}

/** Where a linked pull request stands on GitHub. */
export enum ItemLinkState {
  OPEN = 'open',
  MERGED = 'merged',
  /** Closed without merging: a rejection, which neither ships nor holds back the work. */
  CLOSED = 'closed',
}

/** Whether one service's production release contains one merged pull request. */
export enum ItemReleaseState {
  /** Merged; no successful release contains it yet. */
  PENDING = 'pending',
  /** An ancestor of the newest successful release tag for its service. */
  LIVE = 'live',
  /** The newest release since the merge failed: merged but not deployed. */
  FAILED = 'failed',
}
