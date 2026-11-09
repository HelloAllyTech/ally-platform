import { en } from "@constants";
import {
  ContextCollection,
  ContextGapTopic,
  ContextLoopChange,
  ContextLoopSettings,
  ContextSearchSetup,
  ContextWeeklyPrecision,
} from "@types";

import { humanise } from "./contextLibraryFormat";
import { weekLabel } from "../Builder/scoreboardChart";

/**
 * Pure helpers for Insights, the loop settings and Connect Claude Code. Strings come from
 * `en.contextLibrary`, read inside each function rather than at module load (see
 * ally-web/CLAUDE.md, "No module-load-time work").
 */

/** How many changes the insights carry, and how many each "Show more" asks for. */
export const CHANGES_PAGE = 30;

/** "62%", or "—" while there is nothing to divide. */
export const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${Math.round(value * 100)}%`;

/** nDCG and other 0–1 scores: "0.71", or "—". */
export const formatScore = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);

/** The weekly precision as percentages, nulls kept so a week with nothing judged is a gap. */
export const weeklySpark = (weekly: ContextWeeklyPrecision[] | undefined): (number | null)[] =>
  (weekly ?? []).map(week =>
    week.precision === null || !Number.isFinite(week.precision)
      ? null
      : Math.round(week.precision * 100),
  );

/** One line per week, for screen readers and anyone who wants the numbers behind the line. */
export const weeklyLines = (weekly: ContextWeeklyPrecision[] | undefined): string[] => {
  const strings = en.contextLibrary.insights.helping;
  return (weekly ?? []).map(week =>
    week.precision === null || !week.judged
      ? strings.weekNone(weekLabel(week.week))
      : strings.week(weekLabel(week.week), formatPercent(week.precision), week.judged),
  );
};

/** 0–1 on the wire, a whole percentage on screen. */
export const sampleRatePercent = (rate: number | null | undefined): number =>
  Math.round(Math.min(1, Math.max(0, Number(rate ?? 0))) * 100);

export const isLoopOn = (settings: Pick<ContextLoopSettings, "paused">, loop: string): boolean =>
  !(settings.paused ?? []).includes(loop);

/** The `paused` list after switching one loop on or off. Unknown entries are kept as they were. */
export const withLoop = (paused: string[] | undefined, loop: string, on: boolean): string[] => {
  const rest = (paused ?? []).filter(p => p !== loop);
  return on ? rest : [...rest, loop];
};

/** Nothing is being judged: the judge is paused, or samples none of the searches. */
export const judgeIdle = (settings: ContextLoopSettings | undefined): boolean =>
  !!settings && (!isLoopOn(settings, "judge") || sampleRatePercent(settings.judgeSampleRate) === 0);

export const loopName = (loop: string): string =>
  en.contextLibrary.settings.loops.names[loop] ?? humanise(loop);

/* ── What changed? ─────────────────────────────────────────────────────── */

/** A change in plain words: "Archived FP-0142", "Changed how this collection is searched". */
export const changeHeadline = (
  change: Pick<ContextLoopChange, "action" | "code">,
  noun: string,
) => {
  const strings = en.contextLibrary.insights.changes;
  const code = change.code ?? strings.anEntry(noun);
  const say = strings.actions[change.action];
  return say ? say(code, noun) : strings.unknownAction(humanise(change.action), change.code);
};

/** The cursor for the next page: the oldest change shown so far. */
export const oldestChange = (changes: ContextLoopChange[]): string | undefined =>
  changes.reduce<string | undefined>(
    (oldest, change) => (!oldest || change.createdAt < oldest ? change.createdAt : oldest),
    undefined,
  );

/** A page this full may have more behind it. */
export const mayHaveMore = (page: unknown[] | undefined, size = CHANGES_PAGE): boolean =>
  (page?.length ?? 0) >= size;

/* ── What's missing? ───────────────────────────────────────────────────── */

/**
 * The button a gap offers. The server suggests one (platform gaps want documents, organisation
 * gaps want entries); when the collection can't take that, the other way in is offered instead,
 * and none when it takes neither (synced collections).
 */
export const gapAction = (
  gap: Pick<ContextGapTopic, "action">,
  collection: Pick<ContextCollection, "takesDocuments" | "allowedOrigins"> | undefined,
): "upload" | "entry" | null => {
  if (!collection) return null;
  const canUpload = collection.takesDocuments;
  const canWrite = collection.allowedOrigins.includes("authored");
  if (gap.action === "upload_documents") return canUpload ? "upload" : canWrite ? "entry" : null;
  return canWrite ? "entry" : canUpload ? "upload" : null;
};

/* ── Search setup ──────────────────────────────────────────────────────── */

const RRF_K_DEFAULT = 60;

const weight = (value: number | undefined) =>
  Number.isFinite(value) ? Number(value).toFixed(1) : "—";

/** The setup in force as label/value pairs, in the order Settings shows them. */
export const setupRows = (setup: ContextSearchSetup): Array<{ label: string; value: string }> => {
  const strings = en.contextLibrary.settings.loops.setup;
  return [
    {
      label: strings.weights,
      value: [
        `${strings.keyword} ${weight(setup.weights?.bm25)}`,
        `${strings.meaning} ${weight(setup.weights?.statement)}`,
        `${strings.situations} ${weight(setup.weights?.situations)}`,
      ].join(" · "),
    },
    { label: strings.rerank, value: setup.rerank ? strings.on : strings.off },
    { label: strings.diversity, value: formatScore(setup.mmrLambda) },
    { label: strings.fusion, value: String(setup.rrfK ?? RRF_K_DEFAULT) },
  ];
};

/* ── Connect Claude Code ───────────────────────────────────────────────── */

/**
 * The MCP endpoint, from the API base the app is configured with (`VITE_API_BASE_URL`, the same
 * value every request uses), so there is never a hostname to keep in step. A relative or empty
 * base resolves against the page's own origin.
 */
export const mcpEndpoint = (apiBase: string | undefined, origin: string, path: string): string => {
  const base = `${String(apiBase ?? "").replace(/\/+$/, "")}/api${path}`;
  try {
    return new URL(base, origin).toString();
  } catch {
    return base;
  }
};

/** The two lines an engineer pastes into their shell. */
export const shellLines = (url: string, key: string): string =>
  [`export ALLY_CONTEXT_LIBRARY_URL=${url}`, `export ALLY_CONTEXT_LIBRARY_KEY=${key}`].join("\n");

/** A key's visible start, as listed: `clr_AbC12…`. */
export const keyHint = (prefix: string): string => `${prefix}…`;

/** "9 Nov 2026". */
export const formatDay = (iso?: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
