import { AgentLogEntry, AgentLogsView } from "@types";

import { entryName, plainText, SYSTEM_PROMPT_MARKER } from "./agentLogText";

/**
 * Agent logs (B4): the pure pieces of the readable page. Every entry is split into the same
 * parts — why it ran, what it was given, what it found — and nothing here returns raw JSON;
 * the exact message and reply stay behind "Show the exact message and reply".
 */

export type Origin = "fixed" | "planned" | "top_up" | "unknown";
export type SourceFilter = "all" | Exclude<Origin, "unknown">;

export const originOf = (e: AgentLogEntry): Origin => e.origin ?? "unknown";

export const isProblem = (e: AgentLogEntry): boolean => e.attention || !!e.error;

export interface LogFilters {
  source: SourceFilter;
  /** A step code, or "all". */
  step: string;
  onlyProblems: boolean;
}

export const NO_FILTERS: LogFilters = { source: "all", step: "all", onlyProblems: false };

export const filterEntries = (entries: AgentLogEntry[], f: LogFilters): AgentLogEntry[] =>
  entries.filter(
    e =>
      (f.source === "all" || originOf(e) === f.source) &&
      (f.step === "all" || e.step === f.step) &&
      (!f.onlyProblems || isProblem(e)),
  );

/** Each step once, in the order it first ran, for the Step filter. */
export const stepOptions = (entries: AgentLogEntry[]): { value: string; label: string }[] => {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const e of entries) {
    if (seen.has(e.step)) continue;
    seen.add(e.step);
    out.push({ value: e.step, label: entryName(e.step) });
  }
  return out;
};

// ---------------------------------------------------------------- small readers

type Obj = Record<string, unknown>;
export const asObj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
export const numOr = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// ---------------------------------------------------------------- summary strip

export interface RunSummary {
  seconds: number | null;
  deadlineSeconds: number;
  costUsd: number | null;
  ceilingUsd: number | null;
  /** Agent names the planner added, in order; null when no planner ran (older runs). */
  plannerAdded: string[] | null;
}

const DEFAULT_DEADLINE_MS = 150_000;

export const runSummary = (v: AgentLogsView): RunSummary => {
  const plan = v.entries.find(e => e.step === "plan");
  const planIn = asObj(plan?.input);
  const deadlineMs = numOr(planIn?.deadlineMs) ?? DEFAULT_DEADLINE_MS;
  const ceilingUsd = numOr(planIn?.ceilingUsd);
  const planner = v.entries.find(e => e.step === "planner");
  let plannerAdded: string[] | null = null;
  if (planner) {
    const fromPlanner = asArr(asObj(planner.output)?.actions)
      .map(a => str(asObj(a)?.agent))
      .filter((a): a is string => !!a);
    const fromEntries = v.entries.filter(e => e.origin === "planned").map(e => e.step);
    plannerAdded = [...new Set(fromPlanner.length ? fromPlanner : fromEntries)].map(entryName);
  }
  return {
    seconds: v.run.seconds,
    deadlineSeconds: Math.round(deadlineMs / 1000),
    costUsd: v.run.costUsd,
    ceilingUsd,
    plannerAdded,
  };
};

/** A bar's fill, 0–100, from a value against its limit. */
export const fillPct = (value: number | null, limit: number | null): number =>
  value == null || !limit ? 0 : Math.max(0, Math.min(100, (value / limit) * 100));

// ---------------------------------------------------------------- what it was given

export interface TranscriptLine {
  turn: number | null;
  speaker: string;
  text: string;
}

export type GivenBody =
  | { kind: "transcript"; lines: TranscriptLine[] }
  | { kind: "text"; text: string };

export interface GivenItem {
  key: string;
  label: string;
  /** "18 turns", "6 items"; null when there is nothing to count. */
  count: string | null;
  body: GivenBody;
}

const TURN_LINE = /^\[turn (\d+)\]\s*([A-Z_ ]+):\s?(.*)$/;

const SPEAKER: Record<string, string> = {
  CLIENT: "Client",
  AI_CLIENT: "Client",
  COUNSELLOR: "Learner",
  LEARNER: "Learner",
};

export const parseTranscript = (text: string): TranscriptLine[] => {
  const lines: TranscriptLine[] = [];
  for (const raw of text.split("\n")) {
    const m = TURN_LINE.exec(raw.trim());
    if (m) {
      const who = m[2].trim();
      lines.push({ turn: Number(m[1]), speaker: SPEAKER[who] ?? sentence(who), text: m[3] });
    } else if (raw.trim() && lines.length) {
      lines[lines.length - 1].text += `\n${raw.trim()}`;
    }
  }
  return lines;
};

const sentence = (code: string): string => {
  const w = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return w ? w[0].toUpperCase() + w.slice(1) : w;
};

const GIVEN_LABELS: Record<string, string> = {
  transcript: "Transcript",
  evidence_map: "Evidence map",
  latest_evidence_map: "Evidence map",
  evidence_summary: "Evidence summary",
  available_agents: "Agents it could add",
  session_profile: "Session profile",
  safety_reading: "Safety reading",
  findings: "Findings",
  guidance: "Guidance",
  practice_options: "Practice options",
  progress: "Learner history",
  trainee_history: "Learner history",
  debrief: "Debrief draft",
  draft: "Draft",
  critique: "What to change",
  scenario_skills: "Scenario skills",
};

const givenLabel = (tag: string): string => GIVEN_LABELS[tag] ?? sentence(tag);

const countOf = (body: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (Array.isArray(parsed)) return String(parsed.length);
  } catch {
    // Not JSON: no count.
  }
  return null;
};

/** JSON inside a tag is shown as plain lines; anything else as written. */
const readableBlock = (body: string): string => {
  const t = body.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return plainText(JSON.parse(t));
    } catch {
      return t;
    }
  }
  return t;
};

const TAG = /<([a-z][a-z0-9_]*)>\n?([\s\S]*?)\n?<\/\1>/g;

/** A model's message split into its labelled parts; a code step's inputs one per key. */
export const givenItems = (e: AgentLogEntry): GivenItem[] => {
  if (typeof e.input === "string") {
    const items: GivenItem[] = [];
    for (const m of e.input.matchAll(TAG)) {
      const [, tag, body] = m;
      if (tag === "transcript") {
        const lines = parseTranscript(body);
        items.push({
          key: tag,
          label: givenLabel(tag),
          count: `${lines.length} ${lines.length === 1 ? "turn" : "turns"}`,
          body: { kind: "transcript", lines },
        });
      } else {
        items.push({
          key: `${tag}-${items.length}`,
          label: givenLabel(tag),
          count: countOf(body.trim()),
          body: { kind: "text", text: readableBlock(body) },
        });
      }
    }
    return items;
  }
  const o = asObj(e.input);
  if (!o) return [];
  return Object.entries(o)
    .filter(([, v]) => v !== null && typeof v === "object")
    .map(([k, v]) => ({
      key: k,
      label: keyLabel(k),
      count: Array.isArray(v) ? String(v.length) : null,
      body: { kind: "text", text: plainText(v) },
    }));
};

/** "ceilingUsd" → "Ceiling (USD)"; "learner_turns" → "Learner turns". */
export const keyLabel = (k: string): string => {
  const unit = /Usd$/.test(k) ? " (USD)" : /Ms$/.test(k) ? " (ms)" : "";
  const base = unit ? k.replace(/(Usd|Ms)$/, "") : k;
  return sentence(base.replace(/([a-z0-9])([A-Z])/g, "$1_$2")) + unit;
};

/** The short header lines a model's message opens with ("SESSION LANGUAGE: hi-IN"). */
export const givenFacts = (e: AgentLogEntry): { label: string; value: string }[] => {
  // A code step's plain values (numbers, units, yes/no) are drawn by the page, which keeps
  // the ones worth reading inline and the rest under "Show details" (agentLogReadable.ts).
  if (typeof e.input !== "string") return [];
  const head = e.input.replace(SYSTEM_PROMPT_MARKER, "").replace(TAG, "");
  const out: { label: string; value: string }[] = [];
  for (const line of head.split("\n")) {
    const m = /^([A-Z][A-Z ]{2,30}):\s*(\S.{0,60})$/.exec(line.trim());
    if (m) out.push({ label: sentence(m[1]), value: m[2] });
  }
  return out;
};

// ---------------------------------------------------------------- scores

export interface Dimension {
  name: string;
  score: number;
  reasoning: string | null;
}

export const dimensions = (output: unknown): Dimension[] =>
  asArr(asObj(output)?.dimensions)
    .map(d => asObj(d))
    .filter((d): d is Obj => !!d && numOr(d.score) !== null)
    .map(d => ({
      name: sentence(str(d.dimension) ?? "?"),
      score: d.score as number,
      reasoning: str(d.reasoning),
    }));

export const overallOf = (output: unknown): number | null => {
  const given = numOr(asObj(output)?.overall);
  if (given !== null) return given;
  const ds = dimensions(output);
  if (!ds.length) return null;
  return Math.round((ds.reduce((s, d) => s + d.score, 0) / ds.length) * 10) / 10;
};

/** The bar a draft is held to: from the scoring step of the same round, else 8. */
export const passScoreFor = (entries: AgentLogEntry[], e: AgentLogEntry): number => {
  const scoring = entries.find(
    x => x.step === "score_draft" && x.round === e.round && x.seq > e.seq,
  );
  return numOr(asObj(scoring?.input)?.passScore) ?? 8;
};

/** A header verdict, where a step has one ("Below the bar", "Published"). */
export const verdictOf = (
  entries: AgentLogEntry[],
  e: AgentLogEntry,
): { text: string; good: boolean } | null => {
  if (e.step === "evaluator") {
    const overall = overallOf(e.output);
    if (overall === null) return null;
    return overall >= passScoreFor(entries, e)
      ? { text: "Meets the bar", good: true }
      : { text: "Below the bar", good: false };
  }
  if (e.step === "decide") {
    const status = str(asObj(e.output)?.status);
    return status ? { text: sentence(status), good: status === "published" } : null;
  }
  return null;
};

export const humanCode = sentence;
