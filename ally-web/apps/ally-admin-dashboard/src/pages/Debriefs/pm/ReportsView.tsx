import React from "react";

import { Link, useSearchParams } from "react-router-dom";

import { useGetPmAgentReportQuery, useGetPmAgentReportsQuery } from "@api";
import { formatUsd, shortId } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { PmReport, PmReportChanged, PmReportKind, PmReportListItem } from "@types";

import { inWords } from "../consoleLabels";
import { pmAgentPath, pmReleasePath, pmReportPath } from "../consoleRoutes";
import { TruncatedTitle } from "../consoleRows";

// --- Choosing a report (pure, tested) ------------------------------------------------

const KINDS: PmReportKind[] = ["weekly", "monthly"];

/** Reports of one kind, newest first. */
export const reportsOfKind = (items: PmReportListItem[], kind: PmReportKind): PmReportListItem[] =>
  items.filter(i => i.kind === kind).sort((a, b) => b.period.localeCompare(a.period));

/** The kind to show: the URL's, else Monthly when there is a month, else Weekly. */
export const pickKind = (items: PmReportListItem[], raw: string | null): PmReportKind => {
  if (raw && (KINDS as string[]).includes(raw)) return raw as PmReportKind;
  return items.some(i => i.kind === "monthly") ? "monthly" : "weekly";
};

/** The period to show: the URL's when it exists, else the newest of the kind. */
export const pickPeriod = (
  items: PmReportListItem[],
  kind: PmReportKind,
  raw: string | null,
): string | null => {
  const list = reportsOfKind(items, kind);
  return list.find(i => i.period === raw)?.period ?? list[0]?.period ?? null;
};

/**
 * Switching kind keeps you near the same date: a month goes to its latest weekly report, a week
 * to the month it falls in. Failing that, the nearest older one; failing that, the newest.
 */
export const periodForKind = (
  items: PmReportListItem[],
  from: { kind: PmReportKind; period: string | null },
  to: PmReportKind,
): string | null => {
  const list = reportsOfKind(items, to);
  if (!from.period || from.kind === to) return pickPeriod(items, to, from.period);
  const month = from.period.slice(0, 7);
  if (to === "weekly") {
    return (
      list.find(i => i.period.slice(0, 7) === month)?.period ??
      list.find(i => i.period.slice(0, 7) < month)?.period ??
      list[0]?.period ??
      null
    );
  }
  return list.find(i => i.period <= month)?.period ?? list[0]?.period ?? null;
};

// --- Dates (India time, like the schedules) ------------------------------------------

const IST = "Asia/Kolkata";
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: IST, ...o });
/** "1 Nov 2026" */
const longDate = (iso: string) => fmt(iso, { day: "numeric", month: "short", year: "numeric" });
/** "6 Oct" */
const shortDate = (iso: string) => fmt(iso, { day: "numeric", month: "short" });
/** "Monday 9 Nov" */
const dayDate = (iso: string) => `${fmt(iso, { weekday: "long" })} ${shortDate(iso)}`;

// --- Latest report line on Ideas -----------------------------------------------------

/** Ideas: "Latest report: Week of 9 Nov · October review", each linking to Reports. Only what exists. */
export const LatestReportLine: React.FC = () => {
  const p = en.debriefs.pmPage;
  const { data } = useGetPmAgentReportsQuery();
  const items = data ?? [];
  const week = reportsOfKind(items, "weekly").find(i => i.hasReview);
  const month = reportsOfKind(items, "monthly").find(i => i.hasReview);
  if (!week && !month) return null;
  return (
    <p className="text-sm text-neutral-700" data-testid="pm-latest-report">
      {p.latestReport} {week && <Link to={pmReportPath("weekly", week.period)}>{week.title}</Link>}
      {week && month && " · "}
      {month && (
        <Link to={pmReportPath("monthly", month.period)}>
          {p.monthReview(month.title.split(" ")[0])}
        </Link>
      )}
    </p>
  );
};

// --- The report ----------------------------------------------------------------------

const Chevron: React.FC<{ dir: "left" | "right" }> = ({ dir }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d={dir === "left" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} />
  </svg>
);

const arrowClass =
  "flex h-8 w-8 items-center justify-center border-0 bg-neutral-50 text-typography-900 disabled:cursor-default disabled:text-neutral-300";

type Row = { key: string; code: string; to: string; text: string; meta: string };

const ideaOrRelease = (r: {
  ideaId: string | null;
  releaseId: string | null;
  version: number | null;
}) =>
  r.ideaId
    ? { code: shortId(r.ideaId), to: pmAgentPath("ideas", r.ideaId) }
    : r.releaseId
      ? {
          code: r.version != null ? `v${r.version}` : shortId(r.releaseId),
          to: pmReleasePath(r.releaseId),
        }
      : { code: "", to: pmAgentPath("releases") };

const listRows = (c: PmReportChanged) => {
  const s = en.debriefs.pmPage.reports;
  const name = (p: { name: string | null } | null) => (p ? (p.name ?? s.someone) : null);
  const live: Row[] = c.liveForEveryone.items.map(r => ({
    key: `${r.releaseId}-${r.at}`,
    ...ideaOrRelease(r),
    text: inWords(r.title),
    meta: [
      r.approvedBy ? s.approvedBy(name(r.approvedBy)!) : s.wentLiveAlone,
      shortDate(r.at),
      r.standing.status === "standing"
        ? s.standing
        : r.standing.status === "reverted"
          ? s.revertedOn(shortDate(r.standing.at))
          : s.notYet,
    ].join(" · "),
  }));
  const reverted: Row[] = c.reverted.items.map(r => ({
    key: `${r.releaseId}-${r.at}`,
    ...ideaOrRelease(r),
    text: inWords(r.title),
    meta: [s.revertedHow[r.how](name(r.by)), shortDate(r.at), r.reason ? inWords(r.reason) : null]
      .filter(Boolean)
      .join(" · "),
  }));
  const rejected: Row[] = c.rejected.items.map(r => ({
    key: `${r.ideaId}-${r.at}`,
    ...ideaOrRelease({ ideaId: r.ideaId, releaseId: null, version: null }),
    text: inWords(r.title),
    meta: [
      r.withdrawn ? s.withdrawnBy(name(r.by)) : s.rejectedBy(name(r.by)),
      r.reason ? (r.by ? `“${r.reason}”` : inWords(r.reason)) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
  return [
    { id: "live", title: s.lists.live, rows: live },
    { id: "reverted", title: s.lists.reverted, rows: reverted },
    { id: "rejected", title: s.lists.rejected, rows: rejected },
  ].filter(l => l.rows.length > 0);
};

const tiles = (c: PmReportChanged) => {
  const s = en.debriefs.pmPage.reports;
  const l = c.liveForEveryone;
  const oneRevert = c.reverted.count === 1 ? c.reverted.items[0]?.reason : null;
  return [
    {
      id: "live",
      label: s.tiles.live,
      value: l.count,
      sub: !l.count ? "" : l.byPerson === l.count ? s.allByPerson : s.someByPerson(l.byPerson),
    },
    {
      id: "reverted",
      label: s.tiles.reverted,
      value: c.reverted.count,
      sub: oneRevert ? inWords(oneRevert) : "",
    },
    {
      id: "rejected",
      label: s.tiles.rejected,
      value: c.rejected.count,
      sub: c.rejected.count && c.rejected.items.every(r => r.reason) ? s.withReasons : "",
    },
    { id: "tests", label: s.tiles.tests, value: c.tests.count, sub: s.passed(c.tests.passed) },
    { id: "builder", label: s.tiles.builder, value: c.sentToBuilder.count, sub: "" },
  ];
};

const Changed: React.FC<{ kind: PmReportKind; changed: PmReportChanged }> = ({ kind, changed }) => {
  const s = en.debriefs.pmPage.reports;
  const b = changed.budget;
  const pct = b && b.capUsd > 0 ? Math.min(100, Math.round((b.spentUsd / b.capUsd) * 100)) : 0;
  return (
    <section
      aria-labelledby="pm-report-changed"
      className="flex flex-col gap-[18px] rounded-sm bg-neutral-50 px-[26px] py-[22px]"
      data-testid="pm-report-changed"
    >
      <div>
        <h3 id="pm-report-changed" className="m-0 text-lg font-semibold">
          {s.changedTitle[kind]}
        </h3>
        <p className="mt-1 text-[13px] text-neutral-600">{s.changedNote}</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {tiles(changed).map(t => (
          <div
            key={t.id}
            className="rounded-sm bg-white px-3.5 py-3"
            data-testid={`pm-report-tile-${t.id}`}
          >
            <div className="text-xs text-neutral-600">{t.label}</div>
            <div className="mt-0.5 text-2xl">{t.value}</div>
            <div className="text-xs text-neutral-600">{t.sub}</div>
          </div>
        ))}
      </div>
      {listRows(changed).map(l => (
        <div key={l.id} className="flex flex-col gap-1.5" data-testid={`pm-report-list-${l.id}`}>
          <h4 className="m-0 text-sm font-semibold">{l.title}</h4>
          {l.rows.map(r => (
            <div
              key={r.key}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm bg-white px-3 py-2 text-sm"
            >
              <Link to={r.to} className="text-[13px]">
                {r.code}
              </Link>
              <span className="flex-[1_1_260px]">{r.text}</span>
              <span className="text-xs text-neutral-600">{r.meta}</span>
            </div>
          ))}
        </div>
      ))}
      {b && (
        <div className="flex flex-col gap-1.5" data-testid="pm-report-budget">
          <h4 className="m-0 text-sm font-semibold">{s.budget}</h4>
          <div className="h-2.5 overflow-hidden rounded-sm bg-neutral-100">
            <div className="h-full bg-primary-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-[13px] text-neutral-700">
            {s.budgetLine(
              formatUsd(b.spentUsd),
              formatUsd(b.capUsd),
              formatUsd(b.parts.testsUsd),
              formatUsd(b.parts.pmAgentUsd),
            )}
          </div>
        </div>
      )}
    </section>
  );
};

/** The review text: paragraphs on blank lines, line breaks kept. */
const ReviewText: React.FC<{ text: string }> = ({ text }) => (
  <div
    className="flex flex-col gap-2.5 text-[15px] leading-relaxed text-neutral-800"
    data-testid="pm-report-review"
  >
    {text
      .split(/\n\s*\n/)
      .filter(p => p.trim())
      .map((p, i) => (
        <p key={i} className="m-0 whitespace-pre-wrap">
          {p.trim()}
        </p>
      ))}
  </div>
);

// Printing ("Download as PDF") shows only the report, without the toolbar or the app around it.
const PRINT_CSS = `@media print {
  body * { visibility: hidden; }
  [data-print-root], [data-print-root] * { visibility: visible; }
  [data-print-root] { position: absolute; left: 0; top: 0; width: 100%; }
  [data-print-hide] { display: none !important; }
}`;

const ReportBody: React.FC<{ report: PmReport }> = ({ report }) => {
  const s = en.debriefs.pmPage.reports;
  const k = report.kind;
  return (
    <>
      <Changed kind={k} changed={report.changed} />
      <section aria-labelledby="pm-report-review" className="flex flex-col gap-2.5 px-0.5 py-1">
        <div>
          <h3 id="pm-report-review" className="m-0 text-lg font-semibold">
            {s.reviewTitle[k]}
          </h3>
          {report.review && <p className="mt-1 text-[13px] text-neutral-600">{s.reviewNote[k]}</p>}
        </div>
        {report.review ? (
          <ReviewText text={report.review.text} />
        ) : (
          <p className="m-0 text-[15px] text-neutral-700" data-testid="pm-report-review-pending">
            {s.reviewPending[k]}
          </p>
        )}
      </section>
    </>
  );
};

/** PM agent › Reports (R2-25): weekly reports and monthly reviews, one at a time, chosen in the URL. */
export const ReportsView: React.FC = () => {
  const s = en.debriefs.pmPage.reports;
  const [params, setParams] = useSearchParams();
  const list = useGetPmAgentReportsQuery();
  const items = list.data ?? [];
  const kind = pickKind(items, params.get("kind"));
  const period = pickPeriod(items, kind, params.get("period"));
  const report = useGetPmAgentReportQuery({ kind, period: period ?? "" }, { skip: !period });

  const go = (k: PmReportKind, p: string | null) => {
    const next = new URLSearchParams(params);
    next.set("view", "reports");
    next.set("kind", k);
    if (p) next.set("period", p);
    else next.delete("period");
    setParams(next);
  };

  if (list.isError) {
    return (
      <div className="px-8 py-6" data-testid="pm-reports-error">
        <ErrorPanel
          forbiddenMessage={en.debriefs.noAccess}
          what={s.loadFailed}
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      </div>
    );
  }
  if (!list.data) {
    return (
      <div className="px-8 py-6" data-testid="pm-reports-loading">
        <LoadingBlock lines={8} />
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="px-8 py-6">
        <p className="max-w-[900px] text-[15px] text-neutral-700" data-testid="pm-reports-empty">
          {s.none}
        </p>
      </div>
    );
  }

  const ofKind = reportsOfKind(items, kind);
  const idx = ofKind.findIndex(i => i.period === period);
  const current = idx >= 0 ? ofKind[idx] : null;
  const older = idx >= 0 ? ofKind[idx + 1] : undefined;
  const newer = idx > 0 ? ofKind[idx - 1] : undefined;
  const kicker = !current
    ? ""
    : kind === "monthly"
      ? s.monthlyKicker(current.publishedAt ? longDate(current.publishedAt) : null)
      : s.weeklyKicker(current.publishedAt ? dayDate(current.publishedAt) : null);

  return (
    <div className="flex flex-wrap items-start gap-6 px-8 py-6" data-testid="pm-reports">
      <style>{PRINT_CSS}</style>
      <main className="flex max-w-[900px] flex-[1_1_560px] flex-col gap-5" data-print-root="">
        {/* One row at lg and up: the title truncates (full text in its tooltip), the toolbar keeps
            its line. Below lg the toolbar takes a second row, on purpose. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-nowrap lg:items-end lg:justify-between lg:gap-6">
          <div className="min-w-0">
            <div className="truncate text-[13px] text-neutral-600" data-testid="pm-report-kicker">
              {kicker}
            </div>
            <TruncatedTitle
              as="h2"
              text={current?.title ?? ""}
              className="mt-1 block text-2xl font-normal"
              testId="pm-report-title"
            />
          </div>
          <div
            role="toolbar"
            aria-label={s.toolbar}
            className="flex shrink-0 flex-nowrap items-center gap-3"
            data-print-hide=""
          >
            <div
              role="group"
              aria-label={s.kind}
              className="flex overflow-hidden rounded-sm border border-primary-500"
            >
              {KINDS.map(k => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={k === kind}
                  onClick={() => k !== kind && go(k, periodForKind(items, { kind, period }, k))}
                  className={`h-8 border-0 px-3.5 text-[13px] ${k === kind ? "bg-primary-500 text-white" : "bg-white text-primary-500"}`}
                >
                  {s[k]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label={s.previous[kind]}
                disabled={!older}
                onClick={() => older && go(kind, older.period)}
                className={arrowClass}
              >
                <Chevron dir="left" />
              </button>
              <select
                aria-label={s.periodLabel[kind]}
                value={period ?? ""}
                onChange={e => go(kind, e.target.value)}
                disabled={!ofKind.length}
                className="h-8 border-0 border-b border-neutral-400 bg-neutral-50 px-2.5 text-[13px] text-typography-900"
              >
                {ofKind.map(o => (
                  <option key={o.period} value={o.period}>
                    {o.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={s.next[kind]}
                disabled={!newer}
                onClick={() => newer && go(kind, newer.period)}
                className={arrowClass}
              >
                <Chevron dir="right" />
              </button>
            </div>
          </div>
        </div>

        {!period ? (
          <p className="text-[15px] text-neutral-700" data-testid="pm-reports-empty">
            {s.none}
          </p>
        ) : report.isError ? (
          <div data-testid="pm-report-error">
            <ErrorPanel
              forbiddenMessage={en.debriefs.noAccess}
              what={s.loadFailed}
              error={report.error}
              onRetry={() => void report.refetch()}
            />
          </div>
        ) : !report.data || report.data.period !== period || report.data.kind !== kind ? (
          <div data-testid="pm-report-loading">
            <LoadingBlock lines={6} />
          </div>
        ) : (
          <ReportBody report={report.data} />
        )}

        <div className="flex gap-4 text-sm" data-print-hide="">
          {report.data && (
            <button
              type="button"
              className="text-primary-500 underline"
              onClick={() => window.print()}
            >
              {s.download}
            </button>
          )}
          <Link to={pmAgentPath("releases")}>{s.allReleases}</Link>
        </div>
      </main>
    </div>
  );
};
