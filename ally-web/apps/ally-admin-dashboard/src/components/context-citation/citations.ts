import { ROUTES } from "@constants";

/**
 * Context Library citation codes in agent-written text — `[FP-0142]` in Builder's PRD, `[LD-0004]`
 * or `[CC-0042]` in Course Copilot's chat and blueprint, or several in one bracket — turned into
 * links to the entry they cite (`/context-library?chunk=FP-0142`). Any collection's code works.
 *
 * The pattern mirrors ally-be's citation check (`context-citation.service.ts`): two capital
 * letters, a hyphen and at least four digits, one or more to a bracket.
 *
 * Pure, so it is unit-tested without a DOM. The route is read inside each function rather than
 * at module load (see ally-web/CLAUDE.md, "No module-load-time work").
 */

const CODE = "[A-Z]{2}-\\d{4,}";
/** `[FP-0142]` or `[FP-0142, FP-0007]` — not already a link's text, nor a reference definition. */
const BRACKETED = new RegExp(`\\[(${CODE}(?:\\s*,\\s*${CODE})*)\\](?![(\\[:])`, "g");
const SINGLE = new RegExp(`^${CODE}$`);

export type CitationSegment = { kind: "text"; text: string } | { kind: "code"; code: string };

const codesIn = (inside: string): string[] =>
  inside
    .split(",")
    .map(code => code.trim())
    .filter(Boolean);

export const isCitationCode = (value: string): boolean => SINGLE.test(value);

/** Where a code opens in the Context Library. */
export const citationHref = (code: string): string =>
  `${ROUTES.CONTEXT_LIBRARY}?chunk=${encodeURIComponent(code)}`;

/** The code a link from {@link linkCitations} points at, or null for any other link. */
export const citationCodeFromHref = (href: string | undefined | null): string | null => {
  if (!href) return null;
  const prefix = `${ROUTES.CONTEXT_LIBRARY}?chunk=`;
  if (!href.startsWith(prefix)) return null;
  let code: string;
  try {
    code = decodeURIComponent(href.slice(prefix.length));
  } catch {
    return null;
  }
  return isCitationCode(code) ? code : null;
};

/** Plain text split into text and codes, for places that render text rather than markdown. */
export const splitCitations = (raw: string): CitationSegment[] => {
  const text = String(raw ?? "");
  const segments: CitationSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(BRACKETED)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    codesIn(match[1]).forEach((code, i) => {
      if (i > 0) segments.push({ kind: "text", text: " " });
      segments.push({ kind: "code", code });
    });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
};

const linkProse = (prose: string): string =>
  prose.replace(BRACKETED, (_whole, inside: string) =>
    codesIn(inside)
      .map(code => `[${code}](${citationHref(code)})`)
      .join(" "),
  );

/**
 * Markdown with each citation turned into a link the renderer draws as a chip. Code is left
 * alone: fenced blocks and inline code spans keep their brackets exactly as written.
 */
export const linkCitations = (markdown: string): string => {
  const source = String(markdown ?? "");
  if (!source.includes("[")) return source;
  // Split out fenced blocks (``` or ~~~ to the matching fence or the end), then inline spans.
  const fenced = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)/g;
  let out = "";
  let last = 0;
  for (const match of source.matchAll(fenced)) {
    const start = (match.index ?? 0) + match[1].length;
    out += linkOutsideInlineCode(source.slice(last, start));
    out += source.slice(start, (match.index ?? 0) + match[0].length);
    last = (match.index ?? 0) + match[0].length;
  }
  return out + linkOutsideInlineCode(source.slice(last));
};

const linkOutsideInlineCode = (text: string): string =>
  text
    .split(/(`+[^`]*`+)/g)
    .map((part, i) => (i % 2 === 1 ? part : linkProse(part)))
    .join("");
