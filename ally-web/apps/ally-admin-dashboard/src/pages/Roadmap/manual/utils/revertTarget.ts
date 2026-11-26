import type { ManualChangeRow } from "@types";

/**
 * Undo for a live edit the chat made: `page_edited` carries the new revision's id, and reverting
 * means going back to the revision just before it. The page's change log lists its revisions; the
 * one immediately older than `revisionId` is the target. Null when the edit isn't in the log, or is
 * the page's first revision (nothing to go back to) — the UI then offers "View change" instead.
 */
export const pickRevertTarget = (
  changes: ManualChangeRow[],
  revisionId: string,
  slug?: string,
): ManualChangeRow | null => {
  const rows = (slug ? changes.filter(change => change.slug === slug) : changes)
    .map((change, index) => ({ change, index }))
    // Newest first; the server's order breaks ties between revisions written in the same instant.
    .sort((a, b) => {
      const diff = Date.parse(b.change.at) - Date.parse(a.change.at);
      return Number.isNaN(diff) || diff === 0 ? a.index - b.index : diff;
    })
    .map(({ change }) => change);
  const at = rows.findIndex(change => change.id === revisionId);
  if (at === -1) return null;
  return rows[at + 1] ?? null;
};
