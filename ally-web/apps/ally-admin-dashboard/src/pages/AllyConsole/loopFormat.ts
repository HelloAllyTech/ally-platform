/** Small formatting helpers for the learning loop's audit and trail rows. Pure. */

/** "status_changed" as "Status changed". */
export const humanise = (id: string): string => {
  const words = id.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
};

/**
 * A short readable summary of an audit row's detail: its simple values only (nested objects and
 * lists are left out), at most four, with camelCase keys split into words. Never learner text: the
 * server records counts, ids and the curator's own words.
 */
export const summariseDetail = (detail: Record<string, unknown> | null | undefined): string =>
  Object.entries(detail ?? {})
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${String(value)}`)
    .join(" · ");
