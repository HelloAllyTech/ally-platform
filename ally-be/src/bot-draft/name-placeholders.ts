/**
 * What a model writes for "no change" in a free-text field (Q4 N1, Round 8: Vandrevala was
 * published at /b/unchanged, and a reply said "you can reach unchanged on +91…"; the same word
 * renamed the Goonj draft on 20 Nov). Never a name, a title or a slug.
 */
const PLACEHOLDER =
  /^[\s"'([]*(unchanged|no change|not changed|same|keep|keep it|none|n\/?a|null|undefined|empty|nil|-+|—|tbd|placeholder|leave (it )?(as is|empty|unchanged))[\s"').\]]*$/i;

export function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && PLACEHOLDER.test(value.trim());
}

/** The paths a placeholder must never be written to. */
export const NAME_PATHS = new Set([
  '/name',
  '/assistantName',
  '/branding/assistantName',
  '/branding/title',
]);

/** `value` unless it is empty or a placeholder, else `fallback`. */
export function realName(
  value: string | null | undefined,
  fallback: string,
): string {
  const v = (value ?? '').trim();
  return v && !isPlaceholder(v) ? v : fallback;
}
