import React from "react";

import { Link } from "react-router-dom";

import { formatUsd, shortId } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { DebriefRunStatus } from "@types";

import { languageLabel, recipeLabel } from "../consoleLabels";
import { score } from "../consoleTable";
import { ConsoleTag, TagTone } from "../consoleUi";
import { SessionItem } from "../queue";

/** Judge scores under this read in orange (the bar the judge holds debriefs to). */
export const JUDGE_BAR = 8;

/** The status a card or the session header leads with, and its colour. */
export const statusOf = (s: {
  status: DebriefRunStatus;
  needsPerson?: boolean;
  belowBar?: boolean;
}): { label: string; tone: TagTone } => {
  const h = en.debriefs.home;
  if (s.status === "needs_person" || s.needsPerson)
    return { label: h.status.needs, tone: "warning" };
  if (s.status === "below_bar" || s.belowBar) return { label: h.status.below, tone: "neutral" };
  if (s.status === "published") return { label: en.debriefs.status.published, tone: "success" };
  return { label: en.debriefs.status[s.status] ?? s.status, tone: "neutral" };
};

export const scenarioTitle = (title: string | null | undefined, sessionId: string) =>
  title || en.debriefs.home.untitled(shortId(sessionId));

const ToScoreBadge: React.FC<{ size: number }> = ({ size }) => (
  <span
    role="img"
    aria-label={en.debriefs.home.toScoreBadge}
    title={en.debriefs.home.toScoreBadge}
    data-testid="to-score-badge"
    style={{ width: size, height: size }}
    className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white"
  >
    !
  </span>
);

const time = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";

const Tags: React.FC<{ item: SessionItem; short?: boolean }> = ({ item, short }) => {
  const h = en.debriefs.home;
  const st = statusOf(item);
  return (
    <>
      <ConsoleTag tone={st.tone}>{st.label}</ConsoleTag>
      {item.urgent && <ConsoleTag tone="urgent">{h.urgent}</ConsoleTag>}
      {item.flagged && (
        <ConsoleTag tone="flag">{short ? h.flaggedShort : h.learnerFlagged}</ConsoleTag>
      )}
      {!short && item.riskCue && <ConsoleTag tone="info">{h.importantMoment}</ConsoleTag>}
      {item.escalated && <ConsoleTag tone="info">{en.debriefs.review.escalated}</ConsoleTag>}
      {item.agreementSample && (
        <span title={h.agreementSampleHelp} className="inline-flex">
          <ConsoleTag tone="info">{h.agreementSampleTag}</ConsoleTag>
        </span>
      )}
    </>
  );
};

const metaLine = (item: SessionItem) =>
  [
    item.tenantName ?? "—",
    languageLabel(item.language),
    item.recipe ? recipeLabel(item.recipe) : null,
    en.debriefs.mode[item.mode] ?? null,
    shortId(item.sessionId),
  ]
    .filter(Boolean)
    .join(" · ");

const judgeClass = (item: SessionItem) =>
  item.judgeOverall !== null && item.judgeOverall < JUDGE_BAR
    ? "text-[#8A3800]"
    : "text-typography-900";

const usd = (v: number | null) => (v === null ? "—" : formatUsd(v));
const secs = (v: number | null) => (v === null ? "—" : `${v} s`);

/** One session as a card on the Debriefs home. */
export const SessionCard: React.FC<{
  item: SessionItem;
  to: string;
  selected: boolean;
  showScore: boolean;
}> = ({ item, to, selected, showScore }) => {
  const h = en.debriefs.home;
  return (
    <Link
      to={to}
      data-testid="session-card"
      data-run={item.runId}
      data-selected={selected ? "true" : undefined}
      className={[
        "flex flex-col gap-3.5 rounded-sm bg-neutral-50 px-5 py-[18px] text-typography-900 no-underline",
        selected ? "outline outline-2 outline-primary-500" : "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tags item={item} />
        <span className="ml-auto text-[13px] text-neutral-600">{time(item.createdAt)}</span>
        {showScore && item.toScore && <ToScoreBadge size={22} />}
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[17px] font-semibold">
          {scenarioTitle(item.scenario.title, item.sessionId)}
        </div>
        <div className="text-[13px] text-neutral-600">{metaLine(item)}</div>
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-neutral-100 pt-3">
        {[
          [h.columns.judge, score(item.judgeOverall), judgeClass(item)],
          [h.columns.evaluator, score(item.evaluatorOverall), ""],
          [h.columns.cost, usd(item.costUsd), ""],
          [h.columns.time, secs(item.seconds), ""],
        ].map(([label, value, cls]) => (
          <div key={label}>
            <div className="text-xs text-neutral-600">{label}</div>
            <div className={`text-base font-semibold ${cls}`}>{value}</div>
          </div>
        ))}
      </div>
    </Link>
  );
};

/** One session as a row in the list layout. */
export const SessionRow: React.FC<{
  item: SessionItem;
  to: string;
  selected: boolean;
  showScore: boolean;
}> = ({ item, to, selected, showScore }) => (
  <Link
    to={to}
    data-testid="session-row"
    data-run={item.runId}
    data-selected={selected ? "true" : undefined}
    className={[
      "grid min-w-[980px] grid-cols-[220px_minmax(220px,2fr)_minmax(160px,1.2fr)_70px_70px_70px_60px_100px] items-center gap-3 border-b border-neutral-100 px-5 py-3.5 text-typography-900 no-underline",
      selected ? "outline outline-2 -outline-offset-2 outline-primary-500" : "",
    ].join(" ")}
  >
    <div className="flex flex-wrap gap-1.5">
      <Tags item={item} short />
    </div>
    <div>
      <div className="text-[15px] font-semibold">
        {scenarioTitle(item.scenario.title, item.sessionId)}
      </div>
      <div className="text-xs text-neutral-600">
        {shortId(item.sessionId)} · {languageLabel(item.language)}
        {item.recipe ? ` · ${recipeLabel(item.recipe)}` : ""}
      </div>
    </div>
    <div className="text-sm text-neutral-700">
      {item.tenantName ?? "—"} · {en.debriefs.mode[item.mode] ?? ""}
    </div>
    <div className={`text-sm font-semibold ${judgeClass(item)}`}>{score(item.judgeOverall)}</div>
    <div className="text-sm">{score(item.evaluatorOverall)}</div>
    <div className="text-sm">{usd(item.costUsd)}</div>
    <div className="text-sm">{secs(item.seconds)}</div>
    <div className="flex items-center justify-end gap-2 text-[13px] text-neutral-600">
      {time(item.createdAt)}
      {showScore && item.toScore ? <ToScoreBadge size={20} /> : <span className="w-5" />}
    </div>
  </Link>
);
