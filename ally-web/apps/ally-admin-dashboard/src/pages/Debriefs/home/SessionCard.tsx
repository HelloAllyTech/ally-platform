import React from "react";

import { Link } from "react-router-dom";

import { formatUsd, shortId } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";

import { languageLabel, recipeLabel } from "../consoleLabels";
import { score } from "../consoleTable";
import { ConsoleTag } from "../consoleUi";
import { SessionItem } from "../queue";

/** Judge scores under this read in orange (the bar the judge holds debriefs to). */
export const JUDGE_BAR = 8;

export const statusTone = (item: SessionItem) =>
  item.status === "published"
    ? "success"
    : item.belowBar && item.status !== "needs_person"
      ? "neutral"
      : "warning";

/** The status a card leads with: what a person sees first. */
export const statusLabel = (item: SessionItem): string => {
  const h = en.debriefs.home;
  if (item.status === "needs_person") return h.status.needs;
  if (item.belowBar) return h.status.below;
  return en.debriefs.status[item.status] ?? item.status;
};

export const scenarioTitle = (item: Pick<SessionItem, "scenarioName" | "sessionId">) =>
  item.scenarioName || en.debriefs.home.untitled(shortId(item.sessionId));

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
  return (
    <>
      <ConsoleTag tone={statusTone(item)}>{statusLabel(item)}</ConsoleTag>
      {item.urgent && <ConsoleTag tone="urgent">{h.urgent}</ConsoleTag>}
      {item.flagged && (
        <ConsoleTag tone="flag">{short ? h.flaggedShort : h.learnerFlagged}</ConsoleTag>
      )}
      {!short && item.hasRiskCue && <ConsoleTag tone="info">{h.importantMoment}</ConsoleTag>}
      {item.escalated && <ConsoleTag tone="info">{en.debriefs.review.escalated}</ConsoleTag>}
    </>
  );
};

const metaLine = (item: SessionItem) =>
  [
    item.tenantName ?? "—",
    languageLabel(item.language),
    item.recipeKey ? recipeLabel(item.recipeKey) : null,
    item.mode ? en.debriefs.mode[item.mode] : null,
    shortId(item.sessionId),
  ]
    .filter(Boolean)
    .join(" · ");

const judgeClass = (item: SessionItem) =>
  item.judge !== null && item.judge < JUDGE_BAR ? "text-[#8A3800]" : "text-typography-900";

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
        <div className="text-[17px] font-semibold">{scenarioTitle(item)}</div>
        <div className="text-[13px] text-neutral-600">{metaLine(item)}</div>
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-neutral-100 pt-3">
        {[
          [h.columns.judge, score(item.judge), judgeClass(item)],
          [h.columns.evaluator, score(item.evaluator), ""],
          [h.columns.cost, item.costUsd === null ? "—" : formatUsd(item.costUsd), ""],
          [h.columns.time, item.seconds === null ? "—" : `${item.seconds} s`, ""],
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
      <div className="text-[15px] font-semibold">{scenarioTitle(item)}</div>
      <div className="text-xs text-neutral-600">
        {shortId(item.sessionId)} · {languageLabel(item.language)}
        {item.recipeKey ? ` · ${recipeLabel(item.recipeKey)}` : ""}
      </div>
    </div>
    <div className="text-sm text-neutral-700">
      {item.tenantName ?? "—"}
      {item.mode ? ` · ${en.debriefs.mode[item.mode]}` : ""}
    </div>
    <div className={`text-sm font-semibold ${judgeClass(item)}`}>{score(item.judge)}</div>
    <div className="text-sm">{score(item.evaluator)}</div>
    <div className="text-sm">{item.costUsd === null ? "—" : formatUsd(item.costUsd)}</div>
    <div className="text-sm">{item.seconds === null ? "—" : `${item.seconds} s`}</div>
    <div className="flex items-center justify-end gap-2 text-[13px] text-neutral-600">
      {time(item.createdAt)}
      {showScore && item.toScore ? <ToScoreBadge size={20} /> : <span className="w-5" />}
    </div>
  </Link>
);
