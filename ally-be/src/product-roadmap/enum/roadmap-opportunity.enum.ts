/**
 * Value sets for roadmap_opportunities. Stored as `character varying` per ally-be
 * convention (not Postgres enums), with CHECK constraints in migration 1871000000000
 * recovering the guarantee that a typo can never land in the column.
 *
 * The string values are the WIRE and STORAGE format and are shared verbatim with the
 * standalone app's data — do not rename them without a data migration.
 */
export enum RoadmapOpportunityType {
  IDEA = 'idea',
  BUG = 'bug',
}

/**
 * The opportunity lifecycle. Votes may only be cast on NEW (enforced in
 * RoadmapAllocationService, not by a trigger, because split/merge must be able to
 * redistribute votes on an opportunity that has already moved on).
 *
 * `releasedAt` is stamped only on the TRANSITION into RELEASED, never re-stamped, and is
 * copied rather than regenerated when a released opportunity is split.
 */
export enum RoadmapOpportunityStage {
  NEW = 'new',
  PRIORITISED = 'prioritised',
  RELEASED = 'released',
  ARCHIVED = 'archived',
}

/**
 * Rough size of the work, on the shirt-size scale teams already use in estimation.
 *
 * A JUDGEMENT, not a measurement: the point of shirt sizes is that they are quick and coarse, so
 * they get filled in. Storing hours or points instead invites false precision on something nobody
 * has broken down yet — and the roadmap's job is deciding what is next, which needs "is this a
 * week or a quarter", not "is this 13 points or 21".
 *
 * NULLABLE everywhere. Every existing row has no effort and no backfill can invent one, so
 * "unsized" is a real and permanent state rather than a gap waiting to be filled. Nothing gates
 * on it.
 *
 * Stored as `character varying` per ally-be convention (not a Postgres enum), with a CHECK
 * constraint in the migration recovering the guarantee that a typo cannot land in the column.
 * The string values are the WIRE and STORAGE format.
 */
export enum RoadmapOpportunityEffort {
  S = 's',
  M = 'm',
  L = 'l',
  XL = 'xl',
  XXL = 'xxl',
}

/**
 * Reconciliation state for the derived Weaviate index (ally-ai's `RoadmapOpportunity`
 * collection). Postgres is the system of record; the vector index can drift because a
 * network call can fail, so drift must be detectable and healable.
 *
 *   PENDING — never indexed, or the text changed since it was.
 *   SUCCESS — the vector in Weaviate matches `textHash`.
 *   FAILED  — indexing was attempted `embeddingAttempts` times and threw.
 *   SKIPPED — deliberately not indexed (e.g. soft-deleted, so it must NOT be a
 *             duplicate-check candidate).
 */
export enum RoadmapEmbeddingStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Who filed the opportunity, for admin-side filtering and the author shown on the board —
 * this has no bearing on permissions or on the create pipeline (every path runs through
 * RoadmapOpportunityService.create). Default is STAFF so every pre-existing row and the
 * staff-facing `/opportunities` endpoint need no change.
 */
export enum RoadmapOpportunitySource {
  STAFF = 'staff',
  CONSUMER = 'consumer',
  /**
   * Filed by the PM Agent when an admin accepted one of its cards (src/pm-agent). The board
   * shows "Product Manager Agent" as the author; `createdBy` is still the accepting admin, for
   * audit. Same create pipeline and the same readiness gate as a person's filing.
   */
  PM_AGENT = 'pm_agent',
  /**
   * Filed by the Roadmap cutover (Roadmap v2 P6) for an in-flight direct Builder session that
   * had no idea: one row per session, lead = the session's creator, already accepted. Written
   * only by RoadmapOpportunityService.fileMigratedBuilderSession.
   */
  MIGRATED_BUILDER_SESSION = 'migrated_builder_session',
}

/** The author name the board shows for a `pm_agent` opportunity. */
export const PM_AGENT_AUTHOR_NAME = 'Product Manager Agent';

/**
 * The Owner's review of a submitted idea (plans/roadmap-builder-merge D10, §2.1a).
 * A fact on the opportunity, not a stage: deriveItemStage reads it.
 *
 * NULL is a legal, permanent state for rows nobody has reviewed through Roadmap v2:
 * migration 1983000000100 backfilled every row that existed then to ACCEPTED, and a row
 * filed through the old doors afterwards (flag off) is read as accepted too, the same as
 * the legacy ideas the plan says count as already accepted.
 */
export enum RoadmapReviewState {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
}
