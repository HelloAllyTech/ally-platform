import { en } from "@constants";
import {
  ContextBulkResult,
  ContextChunk,
  ContextChunkOrigin,
  ContextCollection,
  ContextCollectionYield,
  ContextGateFinding,
  ContextSearchBand,
} from "@types";

/**
 * Pure helpers for the Context Library page: the copy glossary (origins, statuses, bands),
 * the yield report written as sentences, bulk dry-run summaries and the entry form's live
 * hints. Strings come from `en.contextLibrary`, read inside each function rather than at
 * module load (see ally-web/CLAUDE.md, "No module-load-time work").
 */

export const ORIGINS: ContextChunkOrigin[] = [
  "distilled",
  "authored",
  "imported",
  "agent",
  "synced",
];

/** The origin badge on a row and in the sheet. */
export const originLabel = (origin: string): string =>
  en.contextLibrary.origins[origin] ?? humanise(origin);

/**
 * The audience badge's word. Global reaches every learner; an organisation admin sees their own
 * organisation as "Your organisation"; a platform admin sees the organisation's name, or a count
 * when an entry is targeted at several. An entry targeted at no one says so.
 */
export const audienceLabel = (
  chunk: { isGlobal: boolean; tenantIds?: string[] | null; ownerTenantId?: string | null },
  ownTenantId?: string,
  orgNames: Record<string, string> = {},
): { label: string; kind: "global" | "organisation" | "nobody" } => {
  const strings = en.contextLibrary.audience;
  if (chunk.isGlobal) return { label: strings.global, kind: "global" };
  const tenants = chunk.tenantIds ?? [];
  const owner = chunk.ownerTenantId ?? (tenants.length === 1 ? tenants[0] : null);
  if (ownTenantId && (owner === ownTenantId || tenants.includes(ownTenantId))) {
    return { label: strings.yours, kind: "organisation" };
  }
  if (!tenants.length) return { label: strings.nobody, kind: "nobody" };
  if (tenants.length === 1) {
    return { label: orgNames[tenants[0]] ?? strings.oneOrganisation, kind: "organisation" };
  }
  return { label: strings.organisations(tenants.length), kind: "organisation" };
};

/** The shorter word on the origin filter chips. */
export const originFilterLabel = (origin: string): string =>
  en.contextLibrary.originFilters[origin] ?? humanise(origin);

export const bandLabel = (band: ContextSearchBand): string => en.contextLibrary.library.bands[band];

/**
 * The status words a row carries, beyond being active. Low confidence and pinned are listed
 * separately because a chunk can be both and still be active.
 */
export const chunkStatusLabels = (
  chunk: Pick<ContextChunk, "status" | "confidence" | "pinned">,
  noun: string,
): string[] => {
  const strings = en.contextLibrary.library;
  const labels: string[] = [];
  if (chunk.status === "superseded") labels.push(strings.mergedInto(noun));
  if (chunk.status === "archived") labels.push(strings.archived);
  if (chunk.status === "candidate") labels.push(strings.candidate);
  if (chunk.confidence === "low") labels.push(strings.lowConfidence);
  if (chunk.pinned) labels.push(strings.pinned);
  return labels;
};

/** `product_strategy` / `goals-metrics` → "Product strategy" / "Goals metrics". */
export const humanise = (value: string): string => {
  const words = String(value).replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
};

/** The collection's noun, or "item(s)" when no single collection is selected. */
export const nounsFor = (
  collection: Pick<ContextCollection, "noun" | "nounPlural"> | undefined,
): { noun: string; nounPlural: string } =>
  collection
    ? { noun: collection.noun, nounPlural: collection.nounPlural }
    : { noun: en.contextLibrary.allNoun, nounPlural: en.contextLibrary.allNounPlural };

export const capitalise = (text: string): string =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

export const ordinal = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

export const formatCost = (usd: number | string | null | undefined): string => {
  const value = Number(usd ?? 0);
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
};

/* ── Documents ─────────────────────────────────────────────────────────── */

const DOCUMENT_EXTENSIONS = [".pdf", ".epub"];

export const isSupportedDocument = (fileName: string): boolean =>
  DOCUMENT_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));

/** Splits a drop into what can be added and what is named and skipped. */
export const splitDocuments = <F extends { name: string }>(
  files: F[],
): { accepted: F[]; skipped: F[] } => ({
  accepted: files.filter(file => isSupportedDocument(file.name)),
  skipped: files.filter(file => !isSupportedDocument(file.name)),
});

export const keptCount = (yields: Record<string, ContextCollectionYield> | undefined): number =>
  Object.values(yields ?? {}).reduce(
    (sum, y) => sum + (y.published ?? 0) + (y.publishedLowConfidence ?? 0),
    0,
  );

export const lowConfidenceCount = (
  yields: Record<string, ContextCollectionYield> | undefined,
): number =>
  Object.values(yields ?? {}).reduce((sum, y) => sum + (y.publishedLowConfidence ?? 0), 0);

/**
 * One collection's yield, written as a sentence a person reads rather than a table:
 * "Read 31 parts · kept 23 principles · strengthened 6 existing ones · left out 9 as too
 * generic · 2 low confidence". Rejections are grouped by the phrase their reason maps to, so
 * two reasons that read the same ("as unclear on their own") are counted together.
 */
export const yieldSentence = (
  y: ContextCollectionYield,
  options: { parts?: number | null; noun: string; nounPlural: string },
): string => {
  const strings = en.contextLibrary.yield;
  const pieces: string[] = [];
  if (options.parts) pieces.push(strings.read(options.parts));
  const kept = (y.published ?? 0) + (y.publishedLowConfidence ?? 0);
  if (kept) pieces.push(strings.kept(kept, options.noun, options.nounPlural));
  if (y.merged) pieces.push(strings.strengthened(y.merged));
  const byPhrase = new Map<string, number>();
  for (const [reason, count] of Object.entries(y.rejected ?? {})) {
    if (!count) continue;
    const phrase = strings.reasons[reason] ?? strings.otherReason;
    byPhrase.set(phrase, (byPhrase.get(phrase) ?? 0) + count);
  }
  [...byPhrase.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([phrase, count]) => pieces.push(strings.leftOut(count, phrase)));
  if (y.overCap) pieces.push(strings.overCap(y.overCap));
  if (y.publishedLowConfidence) pieces.push(strings.low(y.publishedLowConfidence));
  if (!kept && !y.merged && pieces.length <= 1) pieces.push(strings.nothing);
  return capitalise(pieces.join(" · "));
};

/* ── Bulk upload ───────────────────────────────────────────────────────── */

export interface BulkSummary {
  /** The dry run's one line: "38 to create · 4 to update · 2 rejected". */
  line: string;
  canApply: boolean;
  /** The toast after applying: "Ally Guide Library: 38 entries added, 4 updated, 2 skipped". */
  toast: string;
}

export const bulkSummary = (
  result: ContextBulkResult,
  collection: Pick<ContextCollection, "name" | "noun" | "nounPlural">,
): BulkSummary => {
  const strings = en.contextLibrary.bulk;
  const rejected = result.rejected?.length ?? 0;
  return {
    line: strings.dryRun(result.toCreate, result.toUpdate, rejected),
    canApply: result.toCreate + result.toUpdate > 0,
    toast: strings.applied(
      collection.name,
      result.toCreate,
      result.toUpdate,
      rejected,
      collection.noun,
      collection.nounPlural,
    ),
  };
};

/* ── Entry form ────────────────────────────────────────────────────────── */

export interface EntryHint {
  field: string;
  message: string;
}

// Cheap mirrors of ally-be's deterministic gate (util/gate.util.ts). The server stays the
// judge; these only say early what it would say on save.
const UNRESOLVED =
  /\bthis (approach|technique|method|pattern|framework|model|principle|idea|concept)\b/i;
const ATTRIBUTION = [
  /\baccording to\b/i,
  /\bcoined by\b/i,
  /\b(?:in|from) (?:his|her|their) (?:work|research|study|writing)\b/i,
  /\bthe (?:author|authors|writer|writers)\b/i,
  /\b[Aa]s [A-Z][\w.-]*(?:\s+[A-Z][\w.-]*)*\s+(?:argues|argued|says|said|notes|noted|writes|wrote|suggests|suggested|recommends|observed|observes)\b/,
];

/** Live hints for one text field. */
export const textHints = (field: string, text: string, maxChars?: number): EntryHint[] => {
  const strings = en.contextLibrary.entry.hints;
  const hints: EntryHint[] = [];
  if (maxChars && text.length > maxChars) {
    hints.push({ field, message: strings.tooLong(maxChars) });
  }
  const unresolved = text.match(UNRESOLVED);
  if (unresolved) hints.push({ field, message: strings.unresolved(unresolved[0].toLowerCase()) });
  if (ATTRIBUTION.some(re => re.test(text))) hints.push({ field, message: strings.names });
  return hints;
};

/** A server finding as a sentence to show beside its field. */
export const findingMessage = (finding: ContextGateFinding): string => {
  const strings = en.contextLibrary.entry;
  const base = strings.findings[finding.reason] ?? strings.otherFinding;
  return finding.detail && finding.reason !== "verbatim" ? `${base} (${finding.detail})` : base;
};

/** `findings` from a 400 on create/update, if the error carries any. */
export const findingsFromError = (error: unknown): ContextGateFinding[] => {
  const data = (error as { data?: { findings?: unknown; message?: unknown } } | null)?.data;
  if (data && Array.isArray(data.findings)) return data.findings as ContextGateFinding[];
  // Nest wraps an object passed to BadRequestException under `message` in some versions.
  const nested = data?.message as { findings?: unknown } | undefined;
  if (nested && typeof nested === "object" && Array.isArray(nested.findings)) {
    return nested.findings as ContextGateFinding[];
  }
  return [];
};

/** A readable reason from an RTK Query error, for inline error states. */
export const errorReason = (error: unknown): string => {
  const e = error as { status?: unknown; data?: { message?: unknown }; error?: string } | null;
  const message = e?.data?.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.join("; ");
  if (typeof e?.error === "string") return e.error;
  if (typeof e?.status === "number") return `The server answered ${e.status}.`;
  return "";
};

/** Which collections accept a written entry. */
export const takesEntries = (collection: Pick<ContextCollection, "allowedOrigins">): boolean =>
  collection.allowedOrigins.includes("authored");

/** "Distilled" chunks keep a document count; a written one has no documents to count. */
export const sourceCountLine = (
  chunk: Pick<ContextChunk, "origin" | "sourceCount">,
): string | null =>
  chunk.origin === "distilled" && chunk.sourceCount > 0
    ? en.contextLibrary.library.fromDocuments(chunk.sourceCount)
    : null;

/** Up to `limit` facet values as one muted line. */
export const facetLine = (
  facets: Record<string, string | string[]> | undefined,
  limit = 3,
): string =>
  Object.values(facets ?? {})
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .filter(Boolean)
    .slice(0, limit)
    .map(value => humanise(String(value)))
    .join(" · ");

/** Whether a chunk matches every selected facet value (client-side; see LibraryView). */
export const matchesFacets = (
  chunk: Pick<ContextChunk, "facets">,
  selected: Record<string, string[]>,
): boolean =>
  Object.entries(selected).every(([key, wanted]) => {
    if (!wanted.length) return true;
    const value = chunk.facets?.[key];
    const have = Array.isArray(value) ? value : value ? [value] : [];
    return wanted.some(w => have.includes(w));
  });
