/** A canary never takes more than this share of new conversations (`CANARY_MAX_PERCENT` in ally-be). */
export const CANARY_MAX_PERCENT = 30;

/** The plan's usual first share. */
export const DEFAULT_CANARY_PERCENT = 20;

/**
 * The share a person typed, as the whole number the API takes, or null when it is not one in range.
 * Read strictly: "20%", "2e1" and "12.5" are not accepted, because a share silently rounded to
 * something the person did not type is a surprise on a control that changes what learners see.
 */
export const parseCanaryPercent = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= CANARY_MAX_PERCENT ? value : null;
};

/** Which releases can be put in canary: the stages before it, or the canary itself to change its share. */
export const canStartCanary = (status: string): boolean =>
  status === "draft" || status === "candidate" || status === "shadow" || status === "canary";
