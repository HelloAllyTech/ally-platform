/**
 * Events the roadmap emits to connected clients. A discriminated union so every `emit()` call
 * site is type-checked — a typo'd event name is a compile error, not a socket message nobody
 * receives.
 *
 * The old board's deltas (votes, opportunity upserts and deletes, comments, and the board-wide
 * invalidation) went with its page; only the Roadmap's own event is left. Add a member here,
 * and a case to the gateway's `dispatch`, for a new one.
 *
 * `actorId` is on EVERY event and is a hard contract: the client suppresses its own echo with
 * it.
 */
export type RoadmapEvent = {
  /**
   * Roadmap v2 (§5.7b): an idea's fields changed through the v2 routes.
   * Names only, never values: open queues refetch the row, so a field
   * only some people may read (a decline reason) never rides a broadcast.
   */
  kind: 'ITEM_CHANGED';
  actorId: number;
  code: string;
  fields: string[];
};
