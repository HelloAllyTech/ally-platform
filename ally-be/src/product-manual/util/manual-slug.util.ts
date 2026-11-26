import { MANUAL_SLUG_MAX } from '../constants/manual.constants';

export const MANUAL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MANUAL_SLUG_MAX &&
    MANUAL_SLUG_RE.test(value)
  );
}

/**
 * The slugs a body links to: `[[slug]]` or `[[slug|label]]`, deduplicated, in first-seen order. A
 * `[[` that is not a valid slug (e.g. `[[Some Title]]`) is not a link.
 */
export function extractWikilinks(body: string): string[] {
  const re = /\[\[([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|[^\]]*)?\]\]/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(body ?? ''))) {
    if (match[1].length <= MANUAL_SLUG_MAX) seen.add(match[1]);
  }
  return [...seen];
}
