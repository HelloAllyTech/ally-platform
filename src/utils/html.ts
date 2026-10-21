/**
 * Extract visible text from a (possibly HTML) description so list cells and
 * compact previews show readable text instead of raw tags.
 *
 * Mirrors the web util in libs/ui-shared/rich-text-renderer/htmlToPlainText.
 * React Native has no DOMParser, so entity decoding is handled inline for
 * the common named/numeric entities the backend emits.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decode the common named/numeric/hex HTML entities the backend emits into
 * their literal characters. Unknown entities are left untouched.
 */
export const decodeHtmlEntities = (input: string): string =>
  input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });

export const htmlToPlainText = (value: string | undefined | null): string => {
  if (!value) return '';

  const stripped = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');

  return decodeHtmlEntities(stripped).replace(/\s+/g, ' ').trim();
};

/**
 * Like htmlToPlainText, but keeps the author's paragraph and line breaks
 * (<br>, </p>, </li>, headings, …) as newlines, for places that show a full
 * rich-text description rather than a one-line preview.
 */
export const htmlToMultilineText = (
  value: string | undefined | null,
): string => {
  if (!value) return '';

  const stripped = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|ul|ol|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '');

  return decodeHtmlEntities(stripped)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
