import { AUTO_NAME_PATTERN } from './blank/auto-name';

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

/**
 * TF1: a new draft's default name. Not a placeholder (it may be what's shown before anything is
 * named), but never chosen over a real name: the page said "people at Your assistant" while the
 * owner had named it.
 */
const DEFAULT_NAME = /^your assistant$/i;
/** Either default: the old "Your assistant", or "Your new Ally Chatbot DDMMYY1". */
const isDefaultName = (value: string): boolean =>
  DEFAULT_NAME.test(value) || AUTO_NAME_PATTERN.test(value);

/** `value` unless it is empty, a placeholder or the default name (when the fallback is real). */
export function realName(
  value: string | null | undefined,
  fallback: string,
): string {
  const v = (value ?? '').trim();
  if (!v || isPlaceholder(v)) return fallback;
  if (isDefaultName(v) && fallback.trim() && !isDefaultName(fallback.trim()))
    return fallback;
  return v;
}
