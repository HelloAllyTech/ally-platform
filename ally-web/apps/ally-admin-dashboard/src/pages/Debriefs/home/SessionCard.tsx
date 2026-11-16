import React from "react";

import { Link } from "react-router-dom";

import { shortId } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { DebriefRunStatus } from "@types";

import { languageLabel } from "../consoleLabels";
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

const time = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";

/** The one marker a debrief carries in v2: the learner flagged a card. No status pills. */
const FlagMarker: React.FC<{ item: SessionItem; short?: boolean }> = ({ item, short }) =>
  item.flagged ? (
    <ConsoleTag tone="flag" testId="session-flag">
      {short ? en.debriefs.v2.home.flaggedShort : en.debriefs.v2.home.flagged}
    </ConsoleTag>
  ) : null;

const metaLine = (item: SessionItem) =>
  [item.tenantName ?? "—", languageLabel(item.language)].filter(Boolean).join(" · ");

const judgeClass = (item: SessionItem) =>
  item.judgeOverall !== null && item.judgeOverall < JUDGE_BAR
    ? "text-[#8A3800]"
    : "text-typography-900";

/** One session as a card on the Debriefs home (v2): flag, time, scenario, where, Quality score. */
export const SessionCard: React.FC<{
  item: SessionItem;
  to: string;
  selected: boolean;
}> = ({ item, to, selected }) => {
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
      <div className="flex flex-nowrap items-center gap-2">
        <FlagMarker item={item} />
        <span className="ml-auto shrink-0 text-[13px] text-neutral-600">
          {time(item.createdAt)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="truncate text-[17px] font-semibold">
          {scenarioTitle(item.scenario.title, item.sessionId)}
        </div>
        <div className="truncate text-[13px] text-neutral-600">{metaLine(item)}</div>
      </div>
      <div className="border-t border-neutral-100 pt-3">
        <div className="text-xs text-neutral-600" title={h.scoreHelp.judge}>
          {h.columns.judge}
        </div>
        <div className={`text-base font-semibold ${judgeClass(item)}`}>
          {score(item.judgeOverall)}
        </div>
      </div>
    </Link>
  );
};

/** One session as a row in the list layout. */
export const SessionRow: React.FC<{
  item: SessionItem;
  to: string;
  selected: boolean;
}> = ({ item, to, selected }) => (
  <Link
    to={to}
    data-testid="session-row"
    data-run={item.runId}
    data-selected={selected ? "true" : undefined}
    className={[
      "grid min-w-[760px] grid-cols-[120px_minmax(220px,2fr)_minmax(160px,1.2fr)_70px_80px] items-center gap-3 border-b border-neutral-100 px-5 py-3.5 text-typography-900 no-underline",
      selected ? "outline outline-2 -outline-offset-2 outline-primary-500" : "",
    ].join(" ")}
  >
    <div className="flex flex-nowrap">
      <FlagMarker item={item} short />
    </div>
    <div className="min-w-0">
      <div className="truncate text-[15px] font-semibold">
        {scenarioTitle(item.scenario.title, item.sessionId)}
      </div>
      <div className="truncate text-xs text-neutral-600">{languageLabel(item.language)}</div>
    </div>
    <div className="truncate text-sm text-neutral-700">
      {item.tenantName ?? "—"} · {en.debriefs.mode[item.mode] ?? ""}
    </div>
    <div
      className={`text-sm font-semibold ${judgeClass(item)}`}
      title={`${en.debriefs.home.columns.judge}: ${en.debriefs.home.scoreHelp.judge}`}
    >
      {score(item.judgeOverall)}
    </div>
    <div className="text-right text-[13px] text-neutral-600">{time(item.createdAt)}</div>
  </Link>
);
