import type { RoadmapItemRow } from "@types";

/**
 * Live updates never move what you're reading (§4.12). While the list is "held" (pointer over it,
 * or a row selected), rows keep their places: changed rows update in place, new rows wait, and a
 * row that left the view stays, marked `gone`, until the hold ends. The caller shows an
 * "Updated · refresh order" pill when `orderChanged` is true.
 */
export interface DisplayRow {
  row: RoadmapItemRow;
  /** Left the view since the hold began; shown faded until released. */
  gone: boolean;
}

export interface FrozenResult {
  rows: DisplayRow[];
  orderChanged: boolean;
}

export const freezeOrder = (held: RoadmapItemRow[], incoming: RoadmapItemRow[]): FrozenResult => {
  const incomingByCode = new Map(incoming.map(row => [row.code, row]));
  const rows: DisplayRow[] = held.map(row => {
    const fresh = incomingByCode.get(row.code);
    return fresh ? { row: fresh, gone: false } : { row, gone: true };
  });
  const heldCodes = held.map(r => r.code);
  const incomingCodes = incoming.map(r => r.code);
  const orderChanged =
    heldCodes.length !== incomingCodes.length ||
    heldCodes.some((code, i) => code !== incomingCodes[i]);
  return { rows, orderChanged };
};

export const liveRows = (incoming: RoadmapItemRow[]): DisplayRow[] =>
  incoming.map(row => ({ row, gone: false }));
