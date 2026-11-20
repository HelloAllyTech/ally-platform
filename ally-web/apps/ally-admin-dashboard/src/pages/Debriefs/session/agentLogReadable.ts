import { codeWords } from "../consoleLabels";
import { asArr, asObj, numOr, str } from "./agentLogParts";
import { entryName } from "./agentLogText";

/**
 * Agent logs: what a card says by default and what waits behind "Show details".
 * A card's raw fields (the planner's profile, a code step's inputs) are never printed as they
 * come: keys get plain labels, units are clean, and anything empty, zero, false or purely
 * mechanical (milliseconds, dollars of budget) is left out of the default view and kept in the
 * details. Pure functions; nothing here invents a value the entry did not carry.
 */

export interface DetailRow {
  label: string;
  value: string;
  /** The value as logged, to tell what is worth showing by default. */
  raw: unknown;
  /** Time, money and similar: details only, never the default view. */
  mechanical: boolean;
}

/** Keys whose name would read as code, said in plain words. Keys are matched in snake_case. */
const LABELS: Record<string, string> = {
  past_work_on_this_points: "Earlier points to work on",
  past_debriefs: "Past debriefs",
  org_protocols: "Organisation protocols",
  time_left_ms: "Time left",
  budget_left_usd: "Budget left",
  floor_reserve_usd: "Held back for the safe path",
  planner_estimate_usd: "Planner cost estimate",
  planner_model: "Planner model",
  answered: "Steps that answered",
  offered: "Steps offered to the planner",
  next: "Goes next",
  fallback: "Why the planner was skipped",
  fallback_code: "Reason code",
  indic: "Indian-language script",
  has_learner: "Learner on record",
  code_mixed: "Mixes languages",
  script_mismatch: "Script does not match the language",
  live_detections: "Moments flagged live",
  learner_distress: "Learner distress",
  risk_cue_turns: "Risk cues at turns",
  cohort_data: "Cohort data",
  case_memory: "Earlier sessions of the case",
  transcript_gaps: "Gaps in the transcript",
  session_type: "Session type",
  ceiling_usd: "Cost limit",
  deadline_ms: "Time limit",
  learner_turns: "Learner turns",
};

const snake = (k: string): string => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** "floorReserveUsd" → "Held back for the safe path"; unknown keys fall back to plain words. */
export const humanKey = (k: string): string => {
  const s = snake(k);
  if (LABELS[s]) return LABELS[s];
  return codeWords(s.replace(/_(usd|ms)$/, ""));
};

const isMs = (k: string): boolean => /_ms$/.test(snake(k));
const isUsd = (k: string): boolean => /_usd$/.test(snake(k));

/** Time, money: for engineers, so details only. */
export const isMechanical = (k: string): boolean => isMs(k) || isUsd(k);

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

/** Dollars with 2 to 4 decimals: "$0.3554", "$1.00", "$0.0049". */
export const dollars = (n: number): string => {
  const t = n.toFixed(4).replace(/0+$/, "");
  const [whole, dec = ""] = t.split(".");
  return `$${whole}.${dec.padEnd(2, "0")}`;
};

/** "en-IN" → "English (India)"; anything the browser cannot name stays as logged. */
export const languageName = (code: string): string => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

const scalar = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return isMs(k) ? seconds(v) : isUsd(k) ? dollars(v) : String(v);
  const s = String(v);
  if (snake(k) === "language") return languageName(s);
  return CODE.test(s) ? entryName(s) : s;
};

const AGENT_KEYS = new Set(["next", "offered"]);

const valueOf = (k: string, v: unknown): string => {
  if (Array.isArray(v)) {
    if (!v.length) return "none";
    return v
      .map(x =>
        typeof x === "string" && AGENT_KEYS.has(snake(k))
          ? entryName(x)
          : x !== null && typeof x === "object"
            ? valueOf(k, x)
            : scalar(k, x),
      )
      .join(", ");
  }
  const o = asObj(v);
  if (o) {
    const parts = Object.entries(o).map(([ik, iv]) =>
      snake(k) === "answered"
        ? `${entryName(ik)} ${iv === true ? "answered" : iv === false ? "did not answer" : scalar(ik, iv)}`
        : `${humanKey(ik)} ${scalar(ik, iv)}`,
    );
    return parts.length ? parts.join(", ") : "none";
  }
  return AGENT_KEYS.has(snake(k)) && typeof v === "string" ? entryName(v) : scalar(k, v);
};

/** Every field of an object as a labelled row, in plain words and clean units. */
export const detailRows = (value: unknown): DetailRow[] =>
  Object.entries(asObj(value) ?? {})
    .filter(([k, raw]) => k !== "reasoning" && raw !== undefined)
    .map(([k, raw]) => ({
      label: humanKey(k),
      value: valueOf(k, raw),
      raw,
      mechanical: isMechanical(k),
    }));

/** False, zero, none, empty: nothing to read. */
export const isEmptyValue = (v: unknown): boolean => {
  if (v === null || v === undefined || v === "" || v === false || v === 0) return true;
  if (Array.isArray(v)) return v.length === 0;
  const o = asObj(v);
  return o ? Object.values(o).every(isEmptyValue) : false;
};

/** The rows worth reading at a glance: not empty, not mechanical. */
export const meaningfulRows = (rows: DetailRow[]): DetailRow[] =>
  rows.filter(r => !r.mechanical && !isEmptyValue(r.raw));

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const turnsText = (turns: number[]): string =>
  `${turns.length === 1 ? "turn" : "turns"} ${
    turns.length > 1 ? `${turns.slice(0, -1).join(", ")} and ${turns[turns.length - 1]}` : turns[0]
  }`;

/**
 * What the session profile found, as short plain facts: only what is there. "2 risk cues, at
 * turns 18 and 39", "16 learner turns", "English (India)". Nothing for no, zero or false.
 */
export const profileFacts = (profile: unknown): string[] => {
  const p = asObj(profile);
  if (!p) return [];
  const out: string[] = [];
  const cues = numOr(p.risk_cues) ?? 0;
  const cueTurns = asArr(p.risk_cue_turns).filter((t): t is number => typeof t === "number");
  if (cues > 0) {
    out.push(`${plural(cues, "risk cue")}${cueTurns.length ? `, at ${turnsText(cueTurns)}` : ""}`);
  }
  if (p.learner_distress === true) out.push("The learner showed distress");
  const learnerTurns = numOr(p.learner_turns) ?? 0;
  const turns = numOr(p.turns) ?? 0;
  if (learnerTurns > 0) {
    out.push(
      `${plural(learnerTurns, "learner turn")}${turns > learnerTurns ? ` of ${turns}` : ""}`,
    );
  } else if (turns > 0) {
    out.push(plural(turns, "turn"));
  }
  const language = str(p.language);
  if (language) out.push(languageName(language));
  if (p.code_mixed === true) out.push("Mixes languages");
  if (p.indic === true) out.push("Indian-language script");
  if (p.script_mismatch === true) out.push("The script does not match the language");
  const type = str(p.session_type);
  if (type && type !== "standard") out.push(`${codeWords(type)} session`);
  const past = numOr(p.past_debriefs) ?? 0;
  const points = numOr(p.past_work_on_this_points) ?? 0;
  if (past > 0 || points > 0) {
    out.push(
      [
        past > 0 ? plural(past, "past debrief") : null,
        points > 0 ? `${plural(points, "earlier point")} to work on` : null,
      ]
        .filter(Boolean)
        .join(", "),
    );
  }
  if (p.assessment === true) out.push("An assessment attempt");
  if (p.course === true) out.push("Part of a course");
  if (p.case_memory === true) out.push("Part of a case: earlier sessions are remembered");
  if (p.cohort_data === true) out.push("Cohort data is available");
  const protocols = numOr(p.org_protocols) ?? 0;
  if (protocols > 0) out.push(plural(protocols, "organisation protocol"));
  const live = numOr(p.live_detections) ?? 0;
  if (live > 0) out.push(`${plural(live, "moment")} flagged live`);
  const gaps = numOr(p.transcript_gaps) ?? 0;
  if (gaps > 0) out.push(`${plural(gaps, "gap")} in the transcript`);
  if (p.has_learner === false) out.push("No learner on record");
  return out;
};

const lower = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * One sentence for the profile step, from what it really recorded: who it offered to the
 * planner and where it went next, or why it skipped the planner.
 */
export const profileSentence = (output: unknown): string => {
  const o = asObj(output) ?? {};
  const names = asArr(o.offered)
    .filter((a): a is string => typeof a === "string")
    .map(entryName);
  const fallback = str(o.fallback);
  if (fallback) return `Used the default plan without asking the planner: ${lower(fallback)}.`;
  if (str(o.next) === "planner") {
    return names.length
      ? `Looked over the session, then asked the planner to choose from: ${names.join(", ")}.`
      : "Looked over the session, then asked the planner. No extra steps were available to offer.";
  }
  return "Looked over the session and went straight on to run the plan.";
};

/** The profile step's whole record as labelled rows for "Show details": the profile first. */
export const profileDetailRows = (output: unknown): DetailRow[] => {
  const o = asObj(output) ?? {};
  const { profile, ...rest } = o;
  return [...detailRows(profile), ...detailRows(rest)];
};
