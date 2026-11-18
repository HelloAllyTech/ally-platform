import React, { useState } from "react";

import { AgentLogEntry } from "@types";

import {
  asArr,
  asObj,
  dimensions,
  humanCode,
  numOr,
  overallOf,
  passScoreFor,
  str,
} from "./agentLogParts";
import {
  detailRows,
  DetailRow,
  meaningfulRows,
  profileDetailRows,
  profileFacts,
  profileSentence,
} from "./agentLogReadable";
import { entryName, plainText } from "./agentLogText";

/**
 * Agent logs (B4): "What it found / decided", drawn for each kind of step. A step without its
 * own drawing falls back to a key/value list — never raw JSON.
 */

type Obj = Record<string, unknown>;
const objs = (v: unknown): Obj[] =>
  asArr(v)
    .map(asObj)
    .filter((o): o is Obj => !!o);

const Quote: React.FC<{ children: React.ReactNode; code?: string | null }> = ({
  children,
  code,
}) => (
  <blockquote className="m-0 border-l-2 border-neutral-300 pl-3 text-[13px] leading-normal text-neutral-800">
    {code && <span className="mr-1.5 font-semibold text-neutral-600">{code} · </span>}
    {children}
  </blockquote>
);

const OBS_STYLE: Record<string, string> = {
  observed: "bg-[#DEFBE6] text-[#0E6027]",
  done_well: "bg-[#DEFBE6] text-[#0E6027]",
  strength: "bg-[#DEFBE6] text-[#0E6027]",
  partial: "bg-[#FCF4D6] text-[#8A3800]",
  missed: "bg-[#FFF1F1] text-[#A2191F]",
  risk: "bg-[#FFF1F1] text-[#A2191F]",
};

export const Chip: React.FC<{ code: string }> = ({ code }) => (
  <span
    className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
      OBS_STYLE[code] ?? "bg-neutral-100 text-neutral-800"
    }`}
  >
    {humanCode(code)}
  </span>
);

const turnText = (turn: unknown): string | null => {
  const n = numOr(turn);
  return n === null ? null : `Turn ${n}`;
};

/** Safety reader: one row per cue. */
const SafetyFound: React.FC<{ output: Obj }> = ({ output }) => {
  const cues = objs(output.risk_cues);
  const distress = asArr(output.learner_distress);
  return (
    <div className="flex flex-col gap-2" data-testid="found-safety">
      {cues.length ? (
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="text-xs text-neutral-600">
              <th className="py-1 pr-3 font-normal">Turn</th>
              <th className="py-1 pr-3 font-normal">Client said</th>
              <th className="py-1 pr-3 font-normal">Kind</th>
              <th className="py-1 pr-3 font-normal">Strength</th>
              <th className="py-1 font-normal">Learner</th>
            </tr>
          </thead>
          <tbody>
            {cues.map((c, i) => (
              <tr key={i} className="border-t border-neutral-200 align-top">
                <td className="py-1.5 pr-3">{numOr(c.turn_index) ?? "—"}</td>
                <td className="py-1.5 pr-3">{str(c.quote) ? `“${c.quote}”` : "—"}</td>
                <td className="py-1.5 pr-3">{humanCode(str(c.category) ?? "—")}</td>
                <td className="py-1.5 pr-3">{humanCode(str(c.strength) ?? "—")}</td>
                <td className="py-1.5">{humanCode(str(c.learner_response) ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="m-0 text-[13px]">No risk cues.</p>
      )}
      <p className="m-0 text-[13px] text-neutral-700">
        Learner distress:{" "}
        {distress.length
          ? distress.map(d => (typeof d === "string" ? d : plainText(d))).join("; ")
          : "none"}
        .
      </p>
    </div>
  );
};

const SHOWN_SKILLS = 3;

/** Analyst: one row per skill. */
const AnalystFound: React.FC<{ output: Obj; expandAll: boolean }> = ({ output, expandAll }) => {
  const rows = objs(output.behaviours);
  const [all, setAll] = useState(false);
  const shown = all || expandAll ? rows : rows.slice(0, SHOWN_SKILLS);
  return (
    <div className="flex flex-col gap-1.5" data-testid="found-analyst">
      {shown.map((b, i) => {
        const turn = turnText(b.turn_index);
        const quote = str(b.quote);
        return (
          <div key={i} className="flex min-w-0 items-baseline gap-3 text-[13px]">
            <span className="w-[220px] shrink-0 truncate font-semibold" title={str(b.skill) ?? ""}>
              {str(b.skill) ?? "—"}
            </span>
            <Chip code={str(b.observation) ?? "unknown"} />
            <span className="min-w-0 text-neutral-700">
              {[turn, quote ? `“${quote}”` : str(b.note)].filter(Boolean).join(" · ")}
            </span>
          </div>
        );
      })}
      {rows.length > SHOWN_SKILLS && !expandAll && (
        <button
          type="button"
          onClick={() => setAll(a => !a)}
          className="self-start border-0 bg-transparent p-0 text-[13px] text-primary-500 hover:underline"
        >
          {all ? "Show fewer ▴" : `Show all ${rows.length} skills ▾`}
        </button>
      )}
    </div>
  );
};

/** Planner: what it added and why, then what it left out. */
const PlannerFound: React.FC<{ output: Obj }> = ({ output }) => {
  const added = objs(output.actions);
  const left = asArr(output.considered)
    .map(c => (typeof c === "string" ? { agent: c } : asObj(c)))
    .filter((c): c is Obj => !!c);
  return (
    <div className="flex flex-col gap-1.5" data-testid="found-planner">
      {added.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {added.map((a, i) => {
            const turns = asArr(a.focus_turns).filter(t => typeof t === "number");
            return (
              <li key={i}>
                <span className="font-semibold">{entryName(str(a.agent) ?? "?")}</span>
                {turns.length ? ` · turns ${turns.join(", ")}` : ""}
                {str(a.why) ? ` — ${a.why}` : ""}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-[13px]">Added none.</p>
      )}
      {left.length > 0 && (
        <p className="m-0 text-[13px] text-neutral-700">
          Not added:{" "}
          {left
            .map(c => {
              const why = str(c.why) ?? str(c.reason);
              return `${entryName(str(c.agent) ?? "?")}${why ? ` (${why})` : ""}`;
            })
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
};

/** Guidance lookup: the kept passages, with their codes. */
const GuidanceFound: React.FC<{ output: Obj }> = ({ output }) => {
  const passages = objs(output.passages);
  return (
    <div className="flex flex-col gap-2" data-testid="found-guidance">
      {passages.length ? (
        passages.map((p, i) => (
          <Quote key={i} code={str(p.code)}>
            {str(p.title) && <span className="font-semibold">{p.title as string} </span>}
            {str(p.text)}
          </Quote>
        ))
      ) : (
        <p className="m-0 text-[13px]">No passages kept.</p>
      )}
    </div>
  );
};

/** Writer / Reviser: the cards, as the learner sees them. */
const CardsFound: React.FC<{ output: Obj }> = ({ output }) => {
  const c = asObj(output.cards) ?? output;
  const moment = asObj(c.important_moment);
  const worked = objs(c.what_worked);
  const workOn = objs(c.work_on_this);
  const next = asObj(c.practise_next);
  return (
    <div
      className="flex flex-col gap-2 rounded-sm border border-neutral-200 bg-white p-3 text-[13px] leading-normal"
      data-testid="found-cards"
    >
      {str(c.opening) && <p className="m-0 font-secondary text-[15px]">{c.opening as string}</p>}
      {moment && (
        <div>
          <span className="font-semibold text-[#A2191F]">An important moment · </span>
          {str(moment.lead)} {str(moment.body)}
          {str(moment.quote) && <Quote>“{moment.quote as string}”</Quote>}
        </div>
      )}
      {worked.map((w, i) => (
        <div key={`w${i}`}>
          <span className="font-semibold text-[#0E6027]">What worked · </span>
          {str(w.skill) ? `${w.skill} — ` : ""}
          {str(w.lead)} {str(w.body)}
          {str(w.quote) && <Quote>“{w.quote as string}”</Quote>}
        </div>
      ))}
      {workOn.map((w, i) => (
        <div key={`o${i}`}>
          <span className="font-semibold text-[#8A3800]">Work on this · </span>
          {str(w.skill) ? `${w.skill} — ` : ""}
          {str(w.lead)} {str(w.why)}
          {str(w.try_saying) && <span> Try: “{w.try_saying as string}”</span>}
        </div>
      ))}
      {str(c.progress_note) && (
        <div>
          <span className="font-semibold">Progress · </span>
          {c.progress_note as string}
        </div>
      )}
      {next && (
        <div>
          <span className="font-semibold">Practise this next · </span>
          {str(next.skill)}
          {str(next.reason) ? ` — ${next.reason}` : ""}
        </div>
      )}
      {str(c.reflective_question) && (
        <div className="italic text-neutral-700">{c.reflective_question as string}</div>
      )}
    </div>
  );
};

/** Rule checks: what failed, what is only advisory; a tick when nothing did. */
const ChecksFound: React.FC<{ output: Obj }> = ({ output }) => {
  const advisory = new Set(
    asArr(output.advisory).filter((a): a is string => typeof a === "string"),
  );
  const failures = objs(output.failures);
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]" data-testid="found-checks">
      {failures.map((f, i) => {
        const code = str(f.code) ?? "?";
        const soft = advisory.has(code);
        return (
          <li key={i} className={soft ? "text-[#8A3800]" : "text-[#A2191F]"}>
            {soft ? "! " : "✕ "}
            {humanCode(code)}
            {str(f.detail) ? ` — ${f.detail}` : ""}
            {soft ? " (advisory)" : ""}
          </li>
        );
      })}
      <li className="text-[#0E6027]">
        ✓ {failures.length ? "Every other check passed" : "Every check passed"}
      </li>
    </ul>
  );
};

/** Draft score: dimension bars, the overall against the bar, and the fix notes. */
const DraftScoreFound: React.FC<{ output: Obj; bar: number }> = ({ output, bar }) => {
  const dims = dimensions(output);
  const overall = overallOf(output);
  const fixes = asArr(output.fixes).map(f =>
    typeof f === "string" ? f : (str(asObj(f)?.fix) ?? str(asObj(f)?.note) ?? plainText(f)),
  );
  return (
    <div className="flex flex-col gap-2" data-testid="found-draft-score">
      {dims.map(d => (
        <div key={d.name} className="flex items-center gap-3 text-[13px]" title={d.reasoning ?? ""}>
          <span className="w-[180px] shrink-0 truncate">{d.name}</span>
          <span className="h-2 max-w-[260px] flex-1 bg-neutral-100">
            <span
              className="block h-2 bg-primary-500"
              style={{ width: `${Math.min(100, d.score * 10)}%` }}
            />
          </span>
          <span className="w-6 text-right font-semibold">{d.score}</span>
        </div>
      ))}
      {overall !== null && (
        <div className="flex items-center gap-3 text-[13px]" data-testid="draft-overall">
          <span className="w-[180px] shrink-0 font-semibold">Overall · bar is {bar}</span>
          <span className="relative h-2 max-w-[260px] flex-1 bg-neutral-100">
            <span
              className={`block h-2 ${overall >= bar ? "bg-[#24A148]" : "bg-[#DA1E28]"}`}
              style={{ width: `${Math.min(100, overall * 10)}%` }}
            />
            <span
              className="absolute top-[-3px] h-[14px] w-px bg-neutral-900"
              style={{ left: `${bar * 10}%` }}
            />
          </span>
          <span className="w-6 text-right font-semibold">{overall}</span>
        </div>
      )}
      {fixes.length > 0 && (
        <div className="text-[13px]">
          <div className="text-xs text-neutral-600">What to change (sent to the Reviser)</div>
          <ul className="m-0 pl-4">
            {fixes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/** Quality score: the score, its hard fails and a note. */
const QualityFound: React.FC<{ output: Obj }> = ({ output }) => {
  const overall = overallOf(output);
  const fails = asArr(output.hard_fails).map(f =>
    typeof f === "string" ? humanCode(f) : humanCode(str(asObj(f)?.code) ?? "?"),
  );
  const dims = dimensions(output);
  const lowest = dims.length ? dims.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  return (
    <div className="flex items-center gap-4" data-testid="found-quality">
      <span className="font-secondary text-[32px] leading-none">{overall ?? "—"}</span>
      <p className="m-0 text-[13px] text-neutral-800">
        {fails.length ? `Hard fails: ${fails.join(", ")}.` : "No hard fails."}
        {lowest ? ` Lowest: ${lowest.name} ${lowest.score}.` : ""}
        {str(output.note) ? ` ${output.note}` : ""} Scored by a separate AI reviewer that never sees
        how the debrief was written.
      </p>
    </div>
  );
};

/** Findings agents (history, language, …): one line per finding. */
const FindingsFound: React.FC<{ output: Obj }> = ({ output }) => (
  <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]" data-testid="found-findings">
    {objs(output.findings).map((f, i) => (
      <li key={i} className="flex min-w-0 items-baseline gap-2">
        <Chip code={str(f.kind) ?? "context"} />
        <span className="min-w-0">
          {str(f.point)}
          {str(f.quote) ? ` “${f.quote}”` : ""}
          {turnText(f.turn_index) ? ` · ${turnText(f.turn_index)}` : ""}
        </span>
      </li>
    ))}
  </ul>
);

/**
 * "Show details": every raw field of a card, in plain labels and clean units, for engineers.
 * Closed by default; the card itself shows only what a person would act on.
 */
export const Details: React.FC<{ rows: DetailRow[] }> = ({ rows }) => {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="log-details">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="self-start border-0 bg-transparent p-0 text-xs text-primary-500 hover:underline"
      >
        {open ? "Hide details ▴" : "Show details ▾"}
      </button>
      {open && (
        <dl
          className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-xs text-neutral-700"
          data-testid="log-details-rows"
        >
          {rows.map((r, i) => (
            <React.Fragment key={`${r.label}-${i}`}>
              <dt className="text-neutral-600">{r.label}</dt>
              <dd className="m-0 min-w-0 truncate" title={r.value}>
                {r.value}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
};

/** Any other step: what is worth reading as a key/value list; the rest under "Show details". */
export const KeyValues: React.FC<{ value: unknown }> = ({ value }) => {
  const o = asObj(value);
  if (!o) {
    return (
      <p className="m-0 whitespace-pre-wrap text-[13px]" data-testid="found-kv">
        {plainText(value)}
      </p>
    );
  }
  const rows = detailRows(o);
  const shown = meaningfulRows(rows);
  return (
    <div className="flex flex-col gap-1.5">
      {shown.length ? (
        <dl
          className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]"
          data-testid="found-kv"
        >
          {shown.map(r => (
            <React.Fragment key={r.label}>
              <dt className="text-neutral-600">{r.label}</dt>
              <dd className="m-0 min-w-0 whitespace-pre-wrap break-words">{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-[13px] text-neutral-600" data-testid="found-kv">
          Nothing notable.
        </p>
      )}
      {shown.length < rows.length && <Details rows={rows} />}
    </div>
  );
};

/** Session profile: one sentence, the facts worth reading, the raw record behind a button. */
const ProfileFound: React.FC<{ output: Obj }> = ({ output }) => {
  const facts = profileFacts(output.profile);
  return (
    <div className="flex flex-col gap-1.5" data-testid="found-profile">
      <p className="m-0 text-[13px]" data-testid="found-profile-sentence">
        {profileSentence(output)}
      </p>
      {facts.length > 0 && (
        <ul
          className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-neutral-800"
          data-testid="found-profile-facts"
        >
          {facts.map(f => (
            <li key={f} className="min-w-0 truncate" title={f}>
              {f}
            </li>
          ))}
        </ul>
      )}
      <Details rows={profileDetailRows(output)} />
    </div>
  );
};

/** The heading over "What it found": wording and a count where the design has one. */
export const foundHeading = (e: AgentLogEntry): string => {
  const o = asObj(e.output);
  switch (e.step) {
    case "analyst": {
      const n = asArr(o?.behaviours).length;
      return `What it found · ${n} ${n === 1 ? "skill" : "skills"}`;
    }
    case "planner": {
      const n = asArr(o?.actions).length;
      const of = n + asArr(o?.considered).length;
      return `What it decided · added ${n}${of > n ? ` of ${of}` : ""}`;
    }
    case "guidance_lookup": {
      const n = asArr(o?.passages).length;
      return `What it found · ${n} ${n === 1 ? "passage" : "passages"} kept`;
    }
    case "writer":
    case "reviser":
      return "What it wrote · as the learner sees it";
    case "decide":
    case "score_draft":
    case "dispatch":
    case "plan":
      return "What it decided";
    default:
      return "What it found";
  }
};

/** The drawing for one entry's output. */
export const Found: React.FC<{
  entry: AgentLogEntry;
  entries: AgentLogEntry[];
  expandAll: boolean;
}> = ({ entry: e, entries, expandAll }) => {
  const o = asObj(e.output);
  if (!o) {
    if (e.output === null || e.output === undefined) {
      return <p className="m-0 text-[13px] text-neutral-600">No reply.</p>;
    }
    return <KeyValues value={e.output} />;
  }
  switch (e.step) {
    case "safety_reader":
      return <SafetyFound output={o} />;
    case "analyst":
      return <AnalystFound output={o} expandAll={expandAll} />;
    case "planner":
      return <PlannerFound output={o} />;
    case "profile":
      return <ProfileFound output={o} />;
    case "guidance_lookup":
      return <GuidanceFound output={o} />;
    case "writer":
    case "reviser":
      return <CardsFound output={o} />;
    case "checks":
      return <ChecksFound output={o} />;
    case "evaluator":
      return <DraftScoreFound output={o} bar={passScoreFor(entries, e)} />;
    case "judge":
      return <QualityFound output={o} />;
    case "decide":
      return (
        <p className="m-0 text-[13px]" data-testid="found-decision">
          {str(o.why) ?? humanCode(str(o.status) ?? "—")}
        </p>
      );
    case "score_draft": {
      const overall = numOr(o.overall);
      const meets = o.draftMeetsBar === true;
      return (
        <p className="m-0 text-[13px]" data-testid="found-decision">
          {overall !== null ? `Overall ${overall}, ` : ""}
          {meets ? "meets the bar" : "below the bar"}
          {str(o.next) ? `; next: ${entryName(o.next as string)}` : ""}.
        </p>
      );
    }
    default:
      if (Array.isArray(o.findings)) return <FindingsFound output={o} />;
      return <KeyValues value={o} />;
  }
};
