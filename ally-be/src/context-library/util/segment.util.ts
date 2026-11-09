import { createHash } from 'crypto';
import { ExtractedDocument } from 'src/knowledge-base/extractor';
import { chunkDocument, countTokens } from 'src/knowledge-base/util/chunker';
import {
  CL_SEGMENT_LEAD_IN_TOKENS,
  CL_SEGMENT_PROFILE,
} from '../constants/context-library.constants';

/**
 * Turn an extracted document into segments for the extractors.
 *
 * Reuses the Knowledge Base chunker unchanged — it already splits document → heading →
 * paragraph → sentence and never lets a piece span two headings — with a bigger size
 * profile: a segment is what an extractor reads at once, so it carries enough of the
 * argument to distil from.
 */
export interface PreparedSegment {
  ordinal: number;
  text: string;
  /** The previous segment's tail and the next heading, for understanding only. */
  leadIn: string;
  nextHeading: string | null;
  sectionPath: string | null;
  pageFrom: number;
  pageTo: number;
  tokenCount: number;
  textHash: string;
  forOverview: boolean;
  /** Set when the segment is boilerplate that is never extracted. */
  skippedReason: string | null;
}

/**
 * Headings that mark boilerplate. Contributor and author pages are always skipped — the
 * library stores no names, so there is nothing to extract from them that it could keep.
 */
const SKIP_RULES: Array<{ reason: string; pattern: RegExp; locked?: boolean }> =
  [
    { reason: 'contents', pattern: /\b(table of contents|contents)\b/i },
    { reason: 'index', pattern: /^(?:.*›\s*)?index$/i },
    {
      reason: 'legal',
      pattern:
        /\b(legal notice|licen[cs]e|terms of use|disclaimer|trademarks?)\b/i,
    },
    { reason: 'copyright', pattern: /\bcopyright\b/i },
    {
      reason: 'revision_history',
      pattern:
        /\b(revision history|change ?log|release notes|document history)\b/i,
    },
    {
      reason: 'contributors',
      pattern:
        /\b(about the authors?|about the contributors?|contributors|acknowledg(e)?ments?|credits)\b/i,
      locked: true,
    },
  ];

/** Skip reasons an admin cannot turn back on. */
export const LOCKED_SKIP_REASONS: ReadonlySet<string> = new Set(
  SKIP_RULES.filter((r) => r.locked).map((r) => r.reason),
);

const OVERVIEW_HEADING =
  /\b(introduction|overview|summary|preface|executive summary|conclusions?|key takeaways)\b/i;

export function skipReasonFor(
  sectionPath: string | null | undefined,
): string | null {
  if (!sectionPath) return null;
  const leaf = sectionPath.split(/\s*[›>]\s*/).pop() ?? sectionPath;
  for (const rule of SKIP_RULES) {
    if (rule.pattern.test(leaf)) return rule.reason;
  }
  return null;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The last ~`maxTokens` tokens of `text`, cut at a word boundary. */
export function tailTokens(
  text: string,
  maxTokens: number = CL_SEGMENT_LEAD_IN_TOKENS,
): string {
  const parts = text.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    out.unshift(parts[i]);
    if (countTokens(out.join(' ')) >= maxTokens) {
      out.shift();
      break;
    }
  }
  return out.join(' ');
}

export function segmentDocument(
  extracted: ExtractedDocument,
): PreparedSegment[] {
  const pieces = chunkDocument(extracted, { ...CL_SEGMENT_PROFILE });
  const segments: PreparedSegment[] = pieces.map((piece, i) => ({
    ordinal: i,
    text: piece.text,
    leadIn: '',
    nextHeading: null,
    sectionPath: piece.sectionPath ?? null,
    pageFrom: piece.pageFrom,
    pageTo: piece.pageTo,
    tokenCount: piece.tokenCount,
    textHash: hashText(piece.text),
    forOverview: false,
    skippedReason: skipReasonFor(piece.sectionPath),
  }));

  // Context only: the previous segment's tail and where the text goes next. Taken from the
  // previous EXTRACTABLE segment, so a skipped index page never leaks into a lead-in.
  let previous: PreparedSegment | null = null;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.skippedReason) continue;
    segment.leadIn = previous ? tailTokens(previous.text) : '';
    const next = segments.slice(i + 1).find((s) => !s.skippedReason);
    segment.nextHeading =
      next && next.sectionPath !== segment.sectionPath
        ? next.sectionPath
        : null;
    previous = segment;
  }

  // The overview pass reads opening and closing material: headings that say so, else the
  // first two and the last extractable segments.
  const extractable = segments.filter((s) => !s.skippedReason);
  const named = extractable.filter(
    (s) => s.sectionPath && OVERVIEW_HEADING.test(s.sectionPath),
  );
  const chosen = named.length
    ? named.slice(0, 4)
    : [...extractable.slice(0, 2), ...extractable.slice(-1)];
  for (const s of chosen) s.forOverview = true;

  return segments;
}
