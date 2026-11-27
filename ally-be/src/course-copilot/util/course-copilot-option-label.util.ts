/**
 * The model sometimes writes the recommendation into an option's label ("Peer supporters
 * (recommended)") as well as setting recommended:true, and the admin UI adds its own
 * "Recommended" badge, so the trainer saw it twice. The mark comes off the label and becomes the
 * flag; the existing one-recommended rule then applies.
 */
const MARK =
  /\s*(?:[([]\s*recommended\s*[)\]]|[-–—:]\s*recommended)\s*[.!]?\s*$/i;
const LEADING = /^\s*(?:[([]\s*recommended\s*[)\]]|recommended\s*[:–—-])\s*/i;

export function stripRecommendedMark(label: string): {
  label: string;
  marked: boolean;
} {
  const stripped = label.replace(MARK, '').replace(LEADING, '').trim();
  return stripped && stripped !== label.trim()
    ? { label: stripped, marked: true }
    : { label: label.trim(), marked: false };
}
