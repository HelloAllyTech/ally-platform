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

const decodeEntities = (input: string): string =>
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

  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
};
