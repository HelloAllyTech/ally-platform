import type {
  BuilderEvalChecklistItem,
  BuilderEvalFixture,
  BuilderEvalFixtureKind,
  BuilderEvalGates,
  BuilderEvalInterviewPayload,
  BuilderEvalPrdReviewPayload,
  BuilderEvalRun,
  BuilderEvalSuite,
  BuilderEvalSuiteDetail,
  BuilderEvalSuiteTrigger,
} from "@types";

import type { BuilderTagType } from "../builderMotion";

/**
 * Pure derivation and formatting for the eval page.
 *
 * Separate from the components for the usual Builder reasons: the eval's data
 * is written by agents and by people pasting JSON, so every array and every
 * nullable has to be treated as suspect before it reaches a `.map`, and the
 * Carbon table the page uses renders no rows in jsdom, so the row shaping has
 * to be testable as plain functions.
 */

/** The backend's limits (see its DTOs); the editor enforces them so a save is not refused. */
export const MAX_CHECKLIST_ITEMS = 40;
export const MAX_CHECKLIST_TEXT = 600;
export const MAX_FIXTURE_NAME = 120;
export const MAX_FIXTURE_NOTES = 2000;
export const MIN_REPETITIONS = 1;
export const MAX_REPETITIONS = 10;
export const DEFAULT_REPETITIONS = 3;

/** How often the suite list (and an open suite) refresh while something is running. */
export const EVAL_POLL_MS = 10_000;

/** How many suites the list asks for. The backend caps it at 100. */
export const SUITE_LIST_LIMIT = 30;

/** An array, or an empty one: agent-written fields are not trusted to be arrays. */
export const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/* ── Fixtures ───────────────────────────────────────────────────────────── */

/**
 * The checklist as the editor works with it: only entries that are objects with
 * text, a valid kind, and an id (assigned if missing, as the server does).
 */
export const checklistOf = (fixture: BuilderEvalFixture): BuilderEvalChecklistItem[] => {
  if (fixture.kind !== "interview") return [];
  const payload = fixture.payload as Partial<BuilderEvalInterviewPayload> | null | undefined;
  return asArray<unknown>(payload?.checklist)
    .filter(isRecord)
    .filter(item => typeof item.text === "string")
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id.trim() ? item.id : `C${index + 1}`,
      text: item.text as string,
      kind: item.kind === "must_not" ? ("must_not" as const) : ("must" as const),
    }));
};

/** What the admin said, for the read-only context above the checklist. */
export const interviewContextOf = (
  fixture: BuilderEvalFixture,
): { openingMessage: string; adminScript: string[] } | null => {
  if (fixture.kind !== "interview") return null;
  const payload = fixture.payload as Partial<BuilderEvalInterviewPayload> | null | undefined;
  return {
    openingMessage: typeof payload?.openingMessage === "string" ? payload.openingMessage : "",
    adminScript: asArray<unknown>(payload?.adminScript).filter(
      (line): line is string => typeof line === "string",
    ),
  };
};

/** For a `prd_review` fixture: what the critic is expected to do. */
export const expectationOf = (
  fixture: BuilderEvalFixture,
): { blocking: boolean; via: string | null } | null => {
  if (fixture.kind !== "prd_review") return null;
  const expectation = (fixture.payload as Partial<BuilderEvalPrdReviewPayload> | null)?.expect;
  if (!isRecord(expectation) || typeof expectation.blocking !== "boolean") return null;
  return {
    blocking: expectation.blocking,
    via: typeof expectation.via === "string" && expectation.via ? expectation.via : null,
  };
};

/** "C7": one past the highest numbered id in the list, and never one that is already taken. */
export const nextChecklistId = (items: BuilderEvalChecklistItem[]): string => {
  const taken = new Set(items.map(item => item.id));
  const highest = items.reduce((max, item) => {
    const match = /^C(\d+)$/i.exec(item.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  let next = Math.max(highest, items.length) + 1;
  while (taken.has(`C${next}`)) next += 1;
  return `C${next}`;
};

/** Trimmed, blanks dropped, text clipped to what the server accepts. */
export const cleanChecklist = (items: BuilderEvalChecklistItem[]): BuilderEvalChecklistItem[] =>
  items
    .map(item => ({ ...item, text: item.text.trim().slice(0, MAX_CHECKLIST_TEXT) }))
    .filter(item => item.text.length > 0)
    .slice(0, MAX_CHECKLIST_ITEMS);

export const checklistsEqual = (
  a: BuilderEvalChecklistItem[],
  b: BuilderEvalChecklistItem[],
): boolean =>
  a.length === b.length &&
  a.every(
    (item, index) =>
      item.id === b[index].id && item.text === b[index].text && item.kind === b[index].kind,
  );

/** The first line of a note, clipped. Notes say why a fixture is in the set. */
export const shortNote = (notes: string | null | undefined, max = 90): string => {
  const firstLine = (notes ?? "").trim().split("\n")[0]?.trim() ?? "";
  return firstLine.length > max ? `${firstLine.slice(0, max - 1).trimEnd()}…` : firstLine;
};

export interface FixtureRow {
  id: string;
  name: string;
  kind: BuilderEvalFixtureKind;
  /** Interview fixtures only; a PRD-review fixture has an expectation, not a checklist. */
  checklistSize: number | null;
  active: boolean;
  note: string;
}

export const fixtureRows = (fixtures: BuilderEvalFixture[] | undefined): FixtureRow[] =>
  asArray<BuilderEvalFixture>(fixtures).map(fixture => ({
    id: fixture.id,
    name: fixture.name,
    kind: fixture.kind,
    checklistSize: fixture.kind === "interview" ? checklistOf(fixture).length : null,
    active: fixture.active !== false,
    note: shortNote(fixture.notes),
  }));

/* ── Pasted exports ─────────────────────────────────────────────────────── */

export type ParsedPaste =
  | { type: "fixtures"; fixtures: Record<string, unknown>[] }
  | { type: "session"; session: Record<string, unknown>; title: string }
  | { type: "invalid"; reason: "empty" | "notJson" | "unrecognised" | "noFixtures" };

/**
 * What a pasted blob is. A fixtures export (`{ version, fixtures }`, or the bare
 * array) is imported as it stands. A session, the body of
 * `GET /v1/builder/sessions/:id` copied from another environment, is cut into
 * one fixture, which needs a name.
 */
export const parsePastedExport = (text: string): ParsedPaste => {
  const trimmed = text.trim();
  if (!trimmed) return { type: "invalid", reason: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { type: "invalid", reason: "notJson" };
  }

  const fixtureList = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.fixtures)
      ? parsed.fixtures
      : null;
  if (fixtureList) {
    const fixtures = fixtureList.filter(isRecord);
    return fixtures.length > 0
      ? { type: "fixtures", fixtures }
      : { type: "invalid", reason: "noFixtures" };
  }

  if (isRecord(parsed) && Array.isArray(parsed.messages)) {
    return {
      type: "session",
      session: parsed,
      title: typeof parsed.title === "string" ? parsed.title : "",
    };
  }

  return { type: "invalid", reason: "unrecognised" };
};

/* ── Suites ─────────────────────────────────────────────────────────────── */

/** True while any suite is still working: the page polls only then. */
export const anySuiteRunning = (suites: BuilderEvalSuite[] | undefined): boolean =>
  asArray<BuilderEvalSuite>(suites).some(suite => suite.status === "running");

export type SuiteVerdictState = "pass" | "fail" | null;

export interface SuiteRow {
  id: string;
  trigger: BuilderEvalSuiteTrigger;
  status: BuilderEvalSuite["status"];
  createdAt: string;
  /** Null until the suite has a summary (it is written when the suite settles). */
  passed: number | null;
  runs: number | null;
  /** What a running suite is working through: fixtures × repetitions. */
  plannedRuns: number;
  gateViolations: number | null;
  corrections: number | null;
  judgeScore: number | null;
  costUsd: number | null;
  verdict: SuiteVerdictState;
  published: boolean;
  promptCode: string | null;
}

/** Newest first, whatever order the list arrived in. */
const byNewest = (a: BuilderEvalSuite, b: BuilderEvalSuite): number =>
  (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);

export const suiteRows = (suites: BuilderEvalSuite[] | undefined): SuiteRow[] =>
  [...asArray<BuilderEvalSuite>(suites)].sort(byNewest).map(suite => {
    const summary = suite.summary ?? null;
    return {
      id: suite.id,
      trigger: suite.trigger,
      status: suite.status,
      createdAt: suite.createdAt,
      passed: summary ? summary.passed : null,
      runs: summary ? summary.runs : null,
      plannedRuns: asArray(suite.fixtureIds).length * (suite.repetitions || 0),
      gateViolations: summary ? summary.gateViolations : null,
      corrections: summary ? summary.corrections : null,
      judgeScore: summary && typeof summary.judgeScore === "number" ? summary.judgeScore : null,
      costUsd: summary && typeof summary.costUsd === "number" ? summary.costUsd : null,
      verdict: suite.verdict ? (suite.verdict.pass ? "pass" : "fail") : null,
      published: Boolean(suite.publishedAt),
      promptCode: suite.candidate?.promptCode ?? null,
    };
  });

/**
 * What a run has cost on average, from the suites that have settled. The cost
 * warning before a suite uses it, so "roughly a full interview per run" comes
 * with a number once there is one to give. Null when nothing has finished.
 */
export const averageCostPerRun = (suites: BuilderEvalSuite[] | undefined): number | null => {
  let cost = 0;
  let runs = 0;
  for (const suite of asArray<BuilderEvalSuite>(suites)) {
    const summary = suite.summary;
    if (suite.status !== "completed" || !summary || !(summary.runs > 0)) continue;
    if (typeof summary.costUsd !== "number" || !Number.isFinite(summary.costUsd)) continue;
    cost += summary.costUsd;
    runs += summary.runs;
  }
  return runs > 0 && cost > 0 ? cost / runs : null;
};

export const SUITE_TRIGGER_TAG_TYPE: Record<BuilderEvalSuiteTrigger, BuilderTagType> = {
  manual: "blue",
  baseline: "cool-gray",
  prompt_gate: "purple",
};

export const SUITE_STATUS_TAG_TYPE: Record<BuilderEvalSuite["status"], BuilderTagType> = {
  running: "purple",
  completed: "green",
  errored: "red",
};

export const RUN_STATUS_TAG_TYPE: Record<BuilderEvalRun["status"], BuilderTagType> = {
  queued: "cool-gray",
  running: "purple",
  passed: "green",
  failed: "red",
  errored: "red",
};

/* ── Formatting ─────────────────────────────────────────────────────────── */

/** "0.67", or "—": a suite with no judged run has no score, which is not 0. */
export const formatJudgeScore = (score: number | null | undefined): string =>
  typeof score === "number" && Number.isFinite(score) ? score.toFixed(2) : "—";

/** "~$1.23". Eval cost is estimated from token counts and the pricing table, so it says so. */
export const formatEvalCost = (usd: number | null | undefined): string =>
  typeof usd === "number" && Number.isFinite(usd) ? `~$${usd.toFixed(2)}` : "—";

/** "21 Oct, 14:05", or "—" for a missing or unparseable timestamp. */
export const formatStarted = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** "3 of 5", or "—" while the suite has no summary yet. */
export const formatPassed = (passed: number | null, runs: number | null): string =>
  passed === null || runs === null ? "—" : `${passed} of ${runs}`;

/** "18s", "2m 05s": a run's wall clock. "—" when unmeasured. */
export const formatRunDuration = (ms: number | null | undefined): string => {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
};

/* ── Runs ───────────────────────────────────────────────────────────────── */

export const GATE_KEYS = [
  "unseenFailures",
  "askedBeforeReading",
  "unrepairedEditFailures",
  "falseUpdateClaims",
  "consistent",
  "evidenceCited",
] as const;

export type GateKey = (typeof GATE_KEYS)[number];

export interface GateEntry {
  key: GateKey;
  value: number | boolean;
  /** A count above zero, or a flag that is false. */
  failing: boolean;
}

/** All six gates, in the order the docs list them, each marked failing or clean. */
export const gateEntries = (gates: BuilderEvalGates | null | undefined): GateEntry[] => {
  if (!gates) return [];
  return GATE_KEYS.map(key => {
    const value = gates[key];
    const numeric = typeof value === "number" ? value : null;
    return {
      key,
      value: numeric ?? Boolean(value),
      failing: numeric !== null ? numeric > 0 : !value,
    };
  });
};

/** Mirrors the backend's `gateViolations`: every non-zero count plus every false flag. */
export const gateViolationCount = (gates: BuilderEvalGates | null | undefined): number =>
  gateEntries(gates).reduce(
    (sum, entry) => sum + (entry.failing ? (typeof entry.value === "number" ? entry.value : 1) : 0),
    0,
  );

export interface RunGroup {
  fixtureId: string;
  /** From the suite's own summary (the name it ran under), then the live list, then the id. */
  name: string | null;
  kind: BuilderEvalFixtureKind | null;
  runs: BuilderEvalRun[];
  passed: number;
}

/** A suite's runs gathered under their fixture, in the order the fixtures first appear. */
export const groupRunsByFixture = (
  suite: BuilderEvalSuiteDetail | undefined,
  fixtures: BuilderEvalFixture[] | undefined,
): RunGroup[] => {
  if (!suite) return [];
  const summaryByFixture = new Map(
    asArray<NonNullable<BuilderEvalSuiteDetail["summary"]>["fixtures"][number]>(
      suite.summary?.fixtures,
    ).map(row => [row.fixtureId, row]),
  );
  const liveByFixture = new Map(asArray<BuilderEvalFixture>(fixtures).map(row => [row.id, row]));

  const groups = new Map<string, RunGroup>();
  for (const run of asArray<BuilderEvalRun>(suite.runs)) {
    let group = groups.get(run.fixtureId);
    if (!group) {
      const fromSummary = summaryByFixture.get(run.fixtureId);
      const live = liveByFixture.get(run.fixtureId);
      group = {
        fixtureId: run.fixtureId,
        name: fromSummary?.name ?? live?.name ?? null,
        kind: fromSummary?.kind ?? live?.kind ?? null,
        runs: [],
        passed: 0,
      };
      groups.set(run.fixtureId, group);
    }
    group.runs.push(run);
    if (run.status === "passed") group.passed += 1;
  }
  return [...groups.values()].map(group => ({
    ...group,
    runs: [...group.runs].sort((a, b) => a.repetition - b.repetition),
  }));
};

/* ── Download ───────────────────────────────────────────────────────────── */

/** Saves `data` as a pretty-printed JSON file through a temporary link. */
export const downloadJsonFile = (filename: string, data: unknown): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
