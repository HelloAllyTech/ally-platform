/**
 * `[[slug]]` and `[[slug|label]]` in a manual page body, turned into ordinary markdown links before
 * react-markdown sees them. Only slugs the loaded tree knows become links; anything else renders as
 * its label in plain text (the contract allows a link to a page that doesn't exist yet).
 *
 * Code is left alone: a wikilink inside a fenced block or inline code stays literal.
 */

/** Where an internal manual link points. Kept literal (not ROUTES) so this module has no imports. */
export const MANUAL_LINK_PREFIX = "/roadmap/manual/";

const SLUG_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WIKILINK = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;
// Fenced blocks first (``` or ~~~), then inline code spans.
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;

/** Escape the characters that would change how a label renders as markdown. */
export const escapeMarkdownText = (text: string): string =>
  text.replace(/([\\`*_[\]{}()<>#+!|~])/g, "\\$1");

export const isManualSlug = (slug: string): boolean => slug.length <= 120 && SLUG_RULE.test(slug);

export const manualHref = (slug: string): string => `${MANUAL_LINK_PREFIX}${slug}`;

/** The slug of an internal manual href, or null for anything else. */
export const slugFromManualHref = (href: string | undefined | null): string | null => {
  if (!href || !href.startsWith(MANUAL_LINK_PREFIX)) return null;
  const rest = href.slice(MANUAL_LINK_PREFIX.length).split(/[?#]/)[0];
  return isManualSlug(rest) ? rest : null;
};

/**
 * Which slugs exist: a set, or a map of slug → title. With titles, `[[slug]]` reads as the target
 * page's title; an explicit `[[slug|label]]` keeps its label either way.
 */
export type KnownPages = ReadonlySet<string> | ReadonlyMap<string, string>;

const titleOf = (known: KnownPages, slug: string): string | undefined =>
  known instanceof Map ? (known as ReadonlyMap<string, string>).get(slug) : undefined;

const convert = (text: string, known: KnownPages): string =>
  text.replace(WIKILINK, (_match, rawSlug: string, rawLabel?: string) => {
    const slug = rawSlug.trim();
    const exists = isManualSlug(slug) && known.has(slug);
    const label = rawLabel?.trim() || (exists ? titleOf(known, slug) : undefined) || slug;
    const safeLabel = escapeMarkdownText(label);
    if (!exists) return safeLabel;
    return `[${safeLabel}](${manualHref(slug)})`;
  });

export const preprocessWikilinks = (body: string, known: KnownPages): string =>
  body
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : convert(part, known)))
    .join("");

/** Every distinct slug a body links to (existing or not), in order of first mention. */
export const wikilinkSlugs = (body: string): string[] => {
  const seen = new Set<string>();
  body.split(CODE).forEach((part, index) => {
    if (index % 2 === 1) return;
    for (const match of part.matchAll(WIKILINK)) {
      const slug = match[1].trim();
      if (isManualSlug(slug)) seen.add(slug);
    }
  });
  return [...seen];
};

// ── headings ─────────────────────────────────────────────────────────────────────────────────────

/** A heading's anchor id: lower case, words joined with "-". The same function names the TOC. */
export const headingId = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);

export interface ManualHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

/** The h2/h3 headings of a body, for "On this page". Fenced code is skipped. */
export const extractHeadings = (body: string, known?: KnownPages): ManualHeading[] => {
  const headings: ManualHeading[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    // A heading's text as it reads: wikilinks show their label, inline markup drops away.
    const text = match[2]
      .replace(
        WIKILINK,
        (_m, slug: string, label?: string) =>
          label?.trim() || (known ? titleOf(known, slug.trim()) : undefined) || slug.trim(),
      )
      .replace(/[*_`]/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .trim();
    if (!text) continue;
    headings.push({ level: match[1].length === 2 ? 2 : 3, text, id: headingId(text) });
  }
  return headings;
};
