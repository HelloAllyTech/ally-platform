import React from "react";

import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { PmAgentIdeaRow } from "@types";

import { canaryReasonLabel, codeWords } from "../consoleLabels";
import { stage } from "./ideaGroups";

const signed = (x: number | null | undefined) =>
  x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)}`;
const fixed1 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));

export type RungState = "waiting" | "running" | "passed" | "not" | "failed" | "skipped";

/** One rung of the test ladder (v9 FR-52) as a tile: its name, state and the numbers behind it. */
const Rung: React.FC<{
  name: string;
  state: RungState;
  label: string;
  detail: string;
  testId: string;
}> = ({ name, state, label, detail, testId }) => (
  <li
    data-testid={testId}
    className={`flex flex-col gap-0.5 rounded-sm px-3 py-2.5 ${state === "passed" ? "bg-success-50" : "bg-white"}`}
  >
    <span className="text-[13px] font-semibold">{name}</span>
    <span
      className={`text-xs font-semibold ${state === "passed" ? "text-success-600" : state === "failed" || state === "not" ? "text-[#8A3800]" : "text-neutral-600"}`}
    >
      {label}
    </span>
    <span className="text-xs text-neutral-600">{detail}</span>
  </li>
);

/** The test ladder (v9 FR-52) as four tiles. */
export const Ladder: React.FC<{ idea: PmAgentIdeaRow }> = ({ idea }) => {
  const s = en.debriefs.pmAgent;
  const { screen: q, gate: g, trial: t, canary: c } = idea.evidence;
  const words: Record<RungState, string> = {
    waiting: s.rungWaiting,
    running: s.rungRunning,
    passed: s.rungPassed,
    not: s.rungNotPassed,
    failed: s.rungFailed,
    skipped: en.debriefs.pmPage.releases.skipped,
  };
  const qs: RungState = !q
    ? "waiting"
    : q.status === "running"
      ? "running"
      : q.status === "failed"
        ? "failed"
        : q.passed
          ? "passed"
          : "not";
  const gs: RungState = !g
    ? "waiting"
    : g.status !== "done"
      ? g.status === "running"
        ? "running"
        : "failed"
      : g.passed
        ? "passed"
        : "not";
  const ts: RungState = !t
    ? "waiting"
    : t.status === "running"
      ? "running"
      : t.status === "passed"
        ? "passed"
        : "not";
  const cs: RungState = !c
    ? "waiting"
    : c.status === "running"
      ? "running"
      : c.status === "reverted"
        ? "not"
        : "passed";
  return (
    <div>
      <ol className="grid list-none grid-cols-2 gap-2 sm:grid-cols-4" data-testid="idea-ladder">
        <Rung
          testId="idea-screen"
          name={s.ladder.quick}
          state={qs}
          label={q ? words[qs] : s.notScreened}
          detail={
            q?.status === "done"
              ? `${s.screened(signed(q.lift), q.pairs)} · ${formatUsd(q.costUsd)}${q.challengerFailures > 0 ? ` · ${s.unfinished(q.challengerFailures)}` : ""}`
              : ""
          }
        />
        <Rung
          testId="idea-gate"
          name={s.ladder.gate}
          state={gs}
          label={words[gs]}
          detail={
            g?.status === "done"
              ? `${s.gateLine(fixed1(g.baselineMedian), fixed1(g.challengerMedian), g.pairs)}${
                  !g.passed
                    ? ` · ${Object.entries(g.rules)
                        .filter(([, ok]) => !ok)
                        .map(([k]) => s.gateRules[k] ?? codeWords(k))
                        .join(", ")}`
                    : ""
                }`
              : ""
          }
        />
        <Rung
          testId="idea-trial"
          name={s.ladder.trial}
          state={ts}
          label={words[ts]}
          detail={
            t
              ? s.trialLine(
                  t.comparisons,
                  signed(t.meanDifference),
                  signed(t.lower),
                  signed(t.upper),
                )
              : ""
          }
        />
        <Rung
          testId="idea-canary"
          name={s.ladder.canary}
          state={cs}
          label={
            c
              ? (s.canaryStatus[c.status] ?? c.status)
              : stage(idea) === "canary"
                ? en.debriefs.pmPage.needsApproval
                : s.rungWaiting
          }
          detail={
            c
              ? `${s.canaryLine(Math.round(c.share * 100), c.canaryRuns ?? 0, fixed1(c.canaryMedian), fixed1(c.controlMedian))}${
                  c.reason && c.status === "reverted" ? ` · ${canaryReasonLabel(c.reason)}` : ""
                }`
              : ""
          }
        />
      </ol>
    </div>
  );
};

/** One number set against the previous live release ("Since going live"). */
export interface EvidenceStat {
  label: string;
  value: string;
  sub?: string;
  /** true reads green, false red, undefined neutral. */
  good?: boolean;
}

/**
 * The evidence block the Ideas card and the Releases page share: what the change proved before
 * going live (the ladder), and how it has done since (or while it was live), set against the
 * live release before it.
 */
export const EvidenceBlock: React.FC<{
  title: string;
  source?: string | null;
  idea?: PmAgentIdeaRow | null;
  /** The ladder as ally-be sends it for a release (instead of from an idea). */
  rungs?: Array<{ name: string; state: RungState; label: string; detail: string }>;
  beforeTitle?: string;
  afterTitle?: string;
  stats?: EvidenceStat[];
  testId?: string;
}> = ({ title, source, idea, rungs, beforeTitle, afterTitle, stats, testId }) => (
  <section className="flex flex-col gap-3" data-testid={testId ?? "evidence"}>
    <div className="flex flex-wrap items-baseline gap-2">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {source && <span className="text-xs text-neutral-600">{source}</span>}
    </div>
    {!idea && rungs && rungs.length > 0 && (
      <div>
        {beforeTitle && <div className="mb-2 text-xs text-neutral-600">{beforeTitle}</div>}
        <ol
          className="grid list-none grid-cols-2 gap-2 sm:grid-cols-4"
          data-testid="release-ladder"
        >
          {rungs.map(r => (
            <Rung
              key={r.name}
              testId={`rung-${r.name}`}
              name={r.name}
              state={r.state}
              label={r.label}
              detail={r.detail}
            />
          ))}
        </ol>
      </div>
    )}
    {idea && (
      <div>
        {beforeTitle && <div className="mb-2 text-xs text-neutral-600">{beforeTitle}</div>}
        <Ladder idea={idea} />
      </div>
    )}
    {stats && stats.length > 0 && (
      <div>
        {afterTitle && <div className="mb-2 text-xs text-neutral-600">{afterTitle}</div>}
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 rounded-sm bg-white px-4 py-3"
          data-testid="evidence-stats"
        >
          {stats.map(st => (
            <div key={st.label}>
              <div className="text-xs text-neutral-600">{st.label}</div>
              <div className="text-base font-semibold">{st.value}</div>
              {st.sub && (
                <div
                  className={`text-xs ${st.good === true ? "text-success-600" : st.good === false ? "text-destructive-600" : "text-neutral-600"}`}
                >
                  {st.sub}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
  </section>
);
