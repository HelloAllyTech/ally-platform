/** Socket.io message names for the `/product-roadmap` namespace. */
export enum RoadmapEvents {
  CONNECTED = 'CONNECTED',

  // client → server
  JOIN_BOARD = 'JOIN_BOARD',

  // Roadmap v2 (plans/roadmap-v2-build/P2-contract.md). Ignored while roadmap_v2 is off.
  /** server → board room: { code, fields, actorId }. */
  ITEM_CHANGED = 'roadmap:item-changed',
  /** client → server: { code }; the idea page or reading pane is open. */
  JOIN_ITEM = 'roadmap:join-item',
  LEAVE_ITEM = 'roadmap:leave-item',
  /** both ways: who is viewing an idea or typing in one of its boxes. Never stored. */
  PRESENCE = 'roadmap:presence',
}
