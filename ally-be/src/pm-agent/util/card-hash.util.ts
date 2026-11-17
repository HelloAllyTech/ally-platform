import { createHash } from 'crypto';

/** JSON with object keys sorted at every depth, so equal payloads hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

/**
 * The card's version hash: what the admin read is what gets built. Accept is bound to it,
 * and the compiled PRD records it.
 */
export const cardVersionHash = (
  kind: string,
  category: string,
  payload: unknown,
): string => sha256(canonicalJson({ kind, category, payload }));
