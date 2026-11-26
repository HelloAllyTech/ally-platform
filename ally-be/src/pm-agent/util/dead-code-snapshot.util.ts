/**
 * What the code_health lane (and, through the evidence record, the critic) reads for one
 * dead-code module. Two rules, both from a real prod run (2026-11-26): the lane cited
 * "51 unused items" while its evidence listed 21, so the critic rejected the card as
 * ungrounded. The module total and the items actually shown are different numbers, so they
 * are named differently and both are always present; and the item list is fitted to the
 * character budget HERE, whole items only, instead of being cut mid-JSON by the fence.
 */
export interface DeadCodeSnapshot {
  module: string;
  repo: string | null;
  /** Every unused item in the module, as the scan counted them. */
  totalUnused: number;
  /** How many of them `items` lists. */
  itemsListed: number;
  /** totalUnused - itemsListed: found, but not shown. */
  itemsOmitted: number;
  kinds: Record<string, number>;
  items: string[];
  note?: string;
  lastSeenAt: Date | string;
}

interface DeadCodeRowLike {
  key: string;
  lastSeenAt: Date | string;
  metrics?: Record<string, any> | null;
}

export function buildDeadCodeSnapshot(
  row: DeadCodeRowLike,
  maxChars: number,
): DeadCodeSnapshot {
  const metrics = row.metrics ?? {};
  const all: string[] = Array.isArray(metrics.items)
    ? metrics.items.map(String)
    : [];
  const totalUnused = Math.max(Number(metrics.count ?? 0), all.length);
  const make = (items: string[]): DeadCodeSnapshot => {
    const omitted = totalUnused - items.length;
    return {
      module: row.key,
      repo: metrics.repo ?? null,
      totalUnused,
      itemsListed: items.length,
      itemsOmitted: omitted,
      kinds: metrics.kinds ?? {},
      items,
      ...(omitted > 0
        ? {
            note:
              `totalUnused is the module's total; only itemsListed of them are shown. ` +
              `Quote both ("${totalUnused} flagged, ${items.length} listed"), ` +
              `never the total as the number you checked.`,
          }
        : {}),
      lastSeenAt: row.lastSeenAt,
    };
  };
  let kept = all.length;
  let snapshot = make(all);
  while (kept > 0 && JSON.stringify(snapshot).length > maxChars) {
    kept -= 1;
    snapshot = make(all.slice(0, kept));
  }
  return snapshot;
}
