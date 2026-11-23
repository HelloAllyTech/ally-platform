import { ComponentType, createContext, useContext, useMemo, useState } from "react";

import { LineChart } from "@carbon/charts-react";
import { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { useGetStatisticsChartQuery } from "@api";
import type {
  ActivationData,
  AttentionLearnersData,
  CourseFunnelData,
  CourseRankingData,
  CourseTableData,
  CoursesInUseData,
  HeadlineNumbersData,
  ItemFormatData,
  LearnerStatusCountsData,
  LearnerTrendData,
  LearnerTableData,
  MostUsedSimulationsData,
  PracticeHeatmapData,
  QuizPassData,
  RegularityData,
  OrganizationMetricsRange,
  RatingsData,
  ReviewCoverageData,
  ScenarioScoresData,
  ScoreDistributionData,
  SessionLengthData,
  SkillChangeData,
  StatisticsChartEntry,
  TopLearnersData,
  UsageOverTimeData,
} from "@types";

import { PALETTE, lineOpts } from "../chartKit";
import { StatCard } from "./StatCard";
import { STATUS_ORDER, STATUS_STYLE } from "./statusStyle";

/**
 * One renderer per live library chart id (`TSQ-###`, defined in ally-be
 * `tenant-chart-library.constants.ts`). Two kinds:
 *
 * - `data`: the chart endpoint supplies `data`. The host wraps it in a card
 *   (the question as the heading, then `takeaway`) and owns loading, error and
 *   retry. `bare` renderers draw their own surface (the headline tiles).
 * - `self`: the component fetches for itself (the two tables page through
 *   their rows), inside its own card.
 *
 * An id offered by the backend with no renderer here is not shown.
 */

export interface DataRendererProps<T> {
  entry: StatisticsChartEntry;
  data: T;
  /** True when the backend says the sample is small: prefer counts to shares. */
  sparse: boolean;
}

export interface SelfRendererProps {
  entry: StatisticsChartEntry;
  range: OrganizationMetricsRange;
}

// The data type differs per chart, so the registry holds them loosely; each
// component types its own `data`.

type AnyDataRendererProps = DataRendererProps<any>;

export type ChartRenderer =
  | {
      kind: "data";
      Component: ComponentType<AnyDataRendererProps>;
      /** Draws its own surface instead of sitting in a card. */
      bare?: boolean;
      /** One sentence that says what the data shows. Null when there is nothing to say. */

      takeaway?: (data: any, t: TFunction) => string | null;
    }
  | { kind: "self"; Component: ComponentType<SelfRendererProps> };

/** What the dashboard knows that a card might link to. */
export const DashboardContext = createContext<{ learnerTableOnPage: boolean }>({
  learnerTableOnPage: false,
});

const scrollToLearnerTable = () =>
  document
    .querySelector('[data-testid="statistics-card-TSQ-009"]')
    ?.scrollIntoView({ behavior: "smooth", block: "start" });

/** Scenario titles can run to a full sentence; keep them short inside another sentence. */
const shorten = (text: string, max = 40): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

const fmtDays = (days: number | null, t: TFunction): string => {
  if (days == null) return "—";
  if (days <= 0) return t("organizationMetrics.learnerUsage.today");
  return t("organizationMetrics.learnerUsage.daysAgo", { count: days });
};

const StatusChip = ({ status }: { status: keyof typeof STATUS_STYLE }) => {
  const { t } = useTranslation();
  const style = STATUS_STYLE[status];
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: style.chipBg, color: style.chipFg }}
    >
      {t(style.labelKey)}
    </span>
  );
};

// ── TSQ-001 Headline numbers ───────────────────────────────────

const HeadlineNumbers = ({ data }: DataRendererProps<HeadlineNumbersData>) => {
  const { t } = useTranslation();
  const activeShare =
    data.totalRegisteredLearners > 0
      ? Math.round((data.activeUsers / data.totalRegisteredLearners) * 100)
      : null;

  /** "4 more than the previous period", coloured, or null when there is nothing to compare. */
  const change = (now: number, before: number | undefined) => {
    if (before === undefined) return null;
    const diff = now - before;
    if (diff === 0) return { text: t("statisticsLibrary.headline.changeSame"), tone: "same" };
    return diff > 0
      ? { text: t("statisticsLibrary.headline.changeUp", { count: diff }), tone: "up" }
      : { text: t("statisticsLibrary.headline.changeDown", { count: -diff }), tone: "down" };
  };

  const tiles: Array<{
    key: string;
    label: string;
    value: string;
    unit?: string;
    note: string;
    change?: { text: string; tone: string } | null;
  }> = [
    {
      key: "active",
      label: t("statisticsLibrary.headline.activeLearners"),
      value: data.activeUsers.toLocaleString(),
      change: change(data.activeUsers, data.previous?.activeUsers),
      note:
        activeShare === null
          ? t("statisticsLibrary.headline.noLearners")
          : t("statisticsLibrary.headline.activeShare", { percent: activeShare }),
    },
    {
      key: "registered",
      label: t("statisticsLibrary.headline.registeredLearners"),
      value: data.totalRegisteredLearners.toLocaleString(),
      note: t("statisticsLibrary.headline.joined", { count: data.newLearnersOnboarded }),
    },
    {
      key: "simulations",
      label: t("statisticsLibrary.headline.simulationsCompleted"),
      value: data.simulationsCompleted.toLocaleString(),
      change: change(data.simulationsCompleted, data.previous?.simulationsCompleted),
      note:
        data.avgSessionsPerActiveLearner === null
          ? t("organizationMetrics.states.notEnoughData")
          : t("statisticsLibrary.headline.perActiveLearner", {
              count: data.avgSessionsPerActiveLearner,
            }),
    },
    {
      key: "practice",
      label: t("statisticsLibrary.headline.practiceTime"),
      value:
        data.avgPracticeMinutesPerLearner === null
          ? "—"
          : Math.round(data.avgPracticeMinutesPerLearner).toLocaleString(),
      unit:
        data.avgPracticeMinutesPerLearner === null
          ? undefined
          : t("statisticsLibrary.minutesShort"),
      note: t("statisticsLibrary.headline.practiceNote"),
    },
  ];

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      data-testid="statistics-headline-numbers"
    >
      {tiles.map(tile => (
        <div
          key={tile.key}
          className="flex flex-col gap-1.5 rounded-xl border border-[#e3ded2] bg-white px-5 py-4"
          data-testid={`statistics-headline-${tile.key}`}
        >
          <p className="text-sm text-typography-600">{tile.label}</p>
          <p className="font-secondary text-4xl font-semibold leading-tight text-typography-900">
            {tile.value}
            {tile.unit && (
              <span className="ml-1 text-sm font-normal text-typography-600">{tile.unit}</span>
            )}
          </p>
          {tile.change && (
            <p
              className="text-sm font-medium"
              style={{
                color:
                  tile.change.tone === "up"
                    ? "#1e6b3a"
                    : tile.change.tone === "down"
                      ? "#8a3a08"
                      : "#5a554b",
              }}
              data-testid={`statistics-headline-${tile.key}-change`}
            >
              {tile.change.text}
            </p>
          )}
          <p className="text-sm text-typography-600">{tile.note}</p>
        </div>
      ))}
    </div>
  );
};

// ── TSQ-007 Learner status ─────────────────────────────────────

const LearnerStatus = ({ data }: DataRendererProps<LearnerStatusCountsData>) => {
  const { t } = useTranslation();
  const { learnerTableOnPage } = useContext(DashboardContext);
  const counted = STATUS_ORDER.reduce((n, s) => n + data.counts[s], 0);
  const label = (s: (typeof STATUS_ORDER)[number]) => t(STATUS_STYLE[s].labelKey);

  if (counted === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.status.none")}</p>;
  }

  const quiet = data.counts.dormant + data.counts.never_started;
  return (
    <div className="flex flex-col gap-4" data-testid="statistics-learner-status">
      <div
        className="flex h-7 gap-0.5 overflow-hidden rounded-md"
        role="img"
        aria-label={STATUS_ORDER.map(s => `${label(s)} ${data.counts[s]}`).join(", ")}
      >
        {STATUS_ORDER.filter(s => data.counts[s] > 0).map(s => (
          <div
            key={s}
            style={{
              width: `${(data.counts[s] / counted) * 100}%`,
              background: STATUS_STYLE[s].bar,
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        {STATUS_ORDER.map(s => (
          <li key={s} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: STATUS_STYLE[s].bar }}
            />
            {label(s)} <strong className="font-semibold">{data.counts[s]}</strong>
          </li>
        ))}
      </ul>
      {data.truncated && (
        <p className="text-xs text-typography-500">
          {t("statisticsLibrary.status.truncated", { count: counted })}
        </p>
      )}
      {learnerTableOnPage && quiet > 0 && (
        <button
          type="button"
          onClick={scrollToLearnerTable}
          className="min-h-11 self-start text-sm font-medium text-[#2a5db0] underline"
          data-testid="statistics-see-learners"
        >
          {t("statisticsLibrary.status.seeLearners", { count: quiet })}
        </button>
      )}
    </div>
  );
};

const learnerStatusTakeaway = (data: LearnerStatusCountsData, t: TFunction) => {
  const counted = STATUS_ORDER.reduce((n, s) => n + data.counts[s], 0);
  if (counted === 0) return null;
  const needNudge = data.counts.at_risk + data.counts.dormant + data.counts.never_started;
  return t("statisticsLibrary.takeaway.status", {
    active: data.counts.active,
    total: counted,
    needNudge,
  });
};

// ── TSQ-008 Top learners ───────────────────────────────────────

const formatHours = (minutes: number): string => `${(minutes / 60).toFixed(1)} h`;

const TopLearners = ({ data }: DataRendererProps<TopLearnersData>) => {
  const { t } = useTranslation();
  if (data.rows.length === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.top.none")}</p>;
  }
  const top = data.rows[0].practiceMinutes;
  return (
    <ol className="flex flex-col gap-3" data-testid="statistics-top-learners">
      {data.rows.map((row, index) => (
        <li key={row.id} className="flex items-center gap-3 text-sm">
          <span className="w-4 text-typography-500">{index + 1}</span>
          <span className="flex-[0_0_32%] truncate text-typography-900">{row.name}</span>
          <span className="h-3 flex-1 rounded-md bg-[#efebe0]">
            <span
              className="block h-3 rounded-md bg-[#2a5db0]"
              style={{ width: `${top > 0 ? (row.practiceMinutes / top) * 100 : 0}%` }}
            />
          </span>
          <span className="flex-[0_0_56px] text-right font-semibold text-typography-900">
            {formatHours(row.practiceMinutes)}
          </span>
        </li>
      ))}
    </ol>
  );
};

const topLearnersTakeaway = (data: TopLearnersData, t: TFunction) =>
  data.rows[0]
    ? t("statisticsLibrary.takeaway.top", {
        name: data.rows[0].name,
        hours: (data.rows[0].practiceMinutes / 60).toFixed(1),
      })
    : null;

// ── TSQ-023 Learners who need attention ────────────────────────

const AttentionLearners = ({ data }: DataRendererProps<AttentionLearnersData>) => {
  const { t } = useTranslation();
  if (data.rows.length === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.attention.none")}</p>;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="statistics-attention">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-typography-600">
            <th className="py-2 pr-2 font-medium">{t("statisticsLibrary.table.learner")}</th>
            <th className="p-2 font-medium">{t("statisticsLibrary.table.lastPractised")}</th>
            <th className="p-2 font-medium">{t("statisticsLibrary.table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => (
            <tr key={row.id} className="border-t border-[#efebe0]">
              <td className="py-3 pr-2 text-typography-900">{row.name}</td>
              <td className="p-2 text-typography-700">{fmtDays(row.daysSinceLastActivity, t)}</td>
              <td className="p-2">
                <StatusChip status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.total > data.rows.length && (
        <p className="text-xs text-typography-500">
          {t("statisticsLibrary.attention.showing", {
            shown: data.rows.length,
            total: data.total,
          })}
        </p>
      )}
    </div>
  );
};

const attentionTakeaway = (data: AttentionLearnersData, t: TFunction) =>
  data.total > 0 ? t("statisticsLibrary.takeaway.attention", { count: data.total }) : null;

// ── TSQ-002 Usage over time ────────────────────────────────────

type UsageMeasure = "activeUsers" | "simulationsCompleted" | "newLearners";

const USAGE_MEASURES: UsageMeasure[] = ["activeUsers", "simulationsCompleted", "newLearners"];

const UsageOverTime = ({ entry, data }: DataRendererProps<UsageOverTimeData>) => {
  const { t } = useTranslation();
  const [measure, setMeasure] = useState<UsageMeasure>("activeUsers");

  const seriesName = t(`statisticsLibrary.usage.measures.${measure}`);
  const rows = useMemo(
    () =>
      data[measure].map(point => ({ group: seriesName, key: point.bucket, value: point.count })),
    [data, measure, seriesName],
  );
  const bucketTitle = t(`organizationMetrics.charts.axis.${data.bucket}`);

  return (
    <div data-testid="statistics-usage-over-time" className="flex flex-col gap-2">
      <label className="flex items-center gap-2 self-end text-sm text-typography-700">
        {t("statisticsLibrary.usage.measure")}
        <select
          className="min-h-9 rounded border border-[#cfc9bb] bg-white px-2 text-sm"
          value={measure}
          onChange={e => setMeasure(e.target.value as UsageMeasure)}
          aria-label={`${entry.question} ${t("statisticsLibrary.usage.measure")}`}
        >
          {USAGE_MEASURES.map(m => (
            <option key={m} value={m}>
              {t(`statisticsLibrary.usage.measures.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <LineChart
        data={rows}
        options={lineOpts({
          leftTitle: seriesName,
          bottomTitle: bucketTitle,
          legend: false,
          colorScale: { [seriesName]: PALETTE.blue },
          // Straight segments: a smoothed curve would draw values between the
          // weeks that were never measured.
          extra: { curve: "curveLinear" },
        })}
      />
    </div>
  );
};

const usageTakeaway = (data: UsageOverTimeData, t: TFunction) => {
  const series = data.activeUsers;
  const peak = series.reduce((best, point) => (point.count > best.count ? point : best), series[0]);
  if (!peak || peak.count === 0) return t("statisticsLibrary.takeaway.usageNone");
  return t("statisticsLibrary.takeaway.usagePeak", { peak: peak.count, bucket: peak.bucket });
};

// ── TSQ-003 Most-used simulations ──────────────────────────────

const MostUsedSimulations = ({ data }: DataRendererProps<MostUsedSimulationsData>) => {
  const { t } = useTranslation();
  const top = data[0]?.sessionCount ?? 0;
  if (data.length === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.mostUsed.none")}</p>;
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="statistics-most-used">
      {data.map((simulation, index) => (
        <li key={simulation.scenarioId} className="flex items-center gap-3 text-sm">
          <span className="w-4 text-typography-500">{index + 1}</span>
          <span className="flex-[0_0_38%] truncate text-typography-900">{simulation.title}</span>
          <span className="h-3 flex-1 rounded-md bg-[#efebe0]">
            <span
              className="block h-3 rounded-md bg-[#2a5db0]"
              style={{ width: `${top > 0 ? (simulation.sessionCount / top) * 100 : 0}%` }}
            />
          </span>
          <span className="flex-[0_0_72px] text-right text-typography-700">
            {t("organizationMetrics.mostUsedSimulations.sessions", {
              count: simulation.sessionCount,
            })}
          </span>
        </li>
      ))}
    </ol>
  );
};

const mostUsedTakeaway = (data: MostUsedSimulationsData, t: TFunction) =>
  data[0]
    ? t("statisticsLibrary.takeaway.mostUsed", {
        title: shorten(data[0].title),
        count: data[0].sessionCount,
      })
    : null;

// ── TSQ-009 / TSQ-013 compact tables ───────────────────────────

const TABLE_PAGE_SIZE = 5;

const Pager = ({
  offset,
  shown,
  total,
  onChange,
}: {
  offset: number;
  shown: number;
  total: number;
  onChange: (offset: number) => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-typography-600">
      <span>
        {total === 0
          ? ""
          : t("statisticsLibrary.table.showing", {
              from: offset + 1,
              to: offset + shown,
              total,
            })}
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - TABLE_PAGE_SIZE))}
          className="min-h-11 rounded border border-[#cfc9bb] bg-white px-3 text-sm font-medium disabled:opacity-50"
        >
          {t("statisticsLibrary.table.previous")}
        </button>
        <button
          type="button"
          disabled={offset + shown >= total}
          onClick={() => onChange(offset + TABLE_PAGE_SIZE)}
          className="min-h-11 rounded border border-[#cfc9bb] bg-white px-3 text-sm font-medium disabled:opacity-50"
        >
          {t("statisticsLibrary.table.next")}
        </button>
      </span>
    </div>
  );
};

const LearnerTable = ({ entry, range }: SelfRendererProps) => {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const { data, isFetching, isError, refetch } = useGetStatisticsChartQuery({
    id: entry.id,
    range,
    limit: TABLE_PAGE_SIZE,
    offset,
    search: search || undefined,
  });
  const table = data?.data as LearnerTableData | undefined;

  return (
    <div data-testid="statistics-card-TSQ-009">
      <StatCard
        title={entry.question}
        takeaway={
          table ? t("statisticsLibrary.takeaway.learnerTable", { count: table.count }) : null
        }
        loading={isFetching && !table}
        error={isError}
        onRetry={refetch}
      >
        {table && (
          <div className="flex flex-col gap-3" data-testid="statistics-learner-table">
            <label className="flex max-w-xs flex-col gap-1 text-xs text-typography-600">
              {t("statisticsLibrary.table.search")}
              <input
                type="search"
                value={search}
                onChange={e => {
                  setOffset(0);
                  setSearch(e.target.value);
                }}
                placeholder={t("statisticsLibrary.table.searchPlaceholder")}
                className="min-h-11 rounded border border-[#cfc9bb] px-3 text-sm text-typography-900"
              />
            </label>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-typography-600">
                    <th className="py-2 pr-2 font-medium">
                      {t("statisticsLibrary.table.learner")}
                    </th>
                    <th className="p-2 font-medium">{t("statisticsLibrary.table.status")}</th>
                    <th className="p-2 font-medium">
                      {t("statisticsLibrary.table.lastPractised")}
                    </th>
                    <th className="p-2 font-medium">{t("statisticsLibrary.table.sessions")}</th>
                    <th className="p-2 font-medium">
                      {t("statisticsLibrary.table.coursesCompleted")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.data.map(row => (
                    <tr key={row.id} className="border-t border-[#efebe0]">
                      <td className="py-3 pr-2 text-typography-900">{row.name}</td>
                      <td className="p-2">
                        <StatusChip status={row.status} />
                      </td>
                      <td className="p-2 text-typography-700">
                        {fmtDays(row.daysSinceLastActivity, t)}
                      </td>
                      <td className="p-2 text-typography-700">{row.roleplaySessionsCompleted}</td>
                      <td className="p-2 text-typography-700">{row.coursesCompleted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              offset={offset}
              shown={table.data.length}
              total={table.count}
              onChange={setOffset}
            />
          </div>
        )}
      </StatCard>
    </div>
  );
};

const CourseTable = ({ entry }: SelfRendererProps) => {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const { data, isFetching, isError, refetch } = useGetStatisticsChartQuery({
    id: entry.id,
    limit: TABLE_PAGE_SIZE,
    offset,
  });
  const table = data?.data as CourseTableData | undefined;

  return (
    <div data-testid="statistics-card-TSQ-013">
      <StatCard
        title={entry.question}
        takeaway={
          table ? t("statisticsLibrary.takeaway.courseTable", { count: table.count }) : null
        }
        loading={isFetching && !table}
        error={isError}
        onRetry={refetch}
      >
        {table && (
          <div className="flex flex-col gap-3" data-testid="statistics-course-table">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-typography-600">
                    <th className="py-2 pr-2 font-medium">{t("statisticsLibrary.table.course")}</th>
                    <th className="p-2 font-medium">{t("statisticsLibrary.table.assigned")}</th>
                    <th className="p-2 font-medium">{t("statisticsLibrary.table.started")}</th>
                    <th className="p-2 font-medium">{t("statisticsLibrary.table.completed")}</th>
                    <th className="p-2 font-medium">{t("statisticsLibrary.table.medianDays")}</th>
                    <th className="p-2 font-medium">{t("statisticsLibrary.table.stalled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {table.data.map(row => {
                    const donePct =
                      row.learnersAssigned > 0
                        ? Math.round((row.learnersCompleted100 / row.learnersAssigned) * 100)
                        : 0;
                    return (
                      <tr key={row.id} className="border-t border-[#efebe0]">
                        <td className="py-3 pr-2 text-typography-900">{row.title}</td>
                        <td className="p-2 text-typography-700">{row.learnersAssigned}</td>
                        <td className="p-2 text-typography-700">{row.learnersStarted}</td>
                        <td className="p-2 text-typography-700">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-16 rounded bg-[#efebe0]" aria-hidden="true">
                              <span
                                className="block h-2 rounded bg-[#1e6b3a]"
                                style={{ width: `${donePct}%` }}
                              />
                            </span>
                            {row.learnersCompleted100} ({donePct}%)
                          </span>
                        </td>
                        <td className="p-2 text-typography-700">
                          {row.medianCompletionDays == null ? "—" : row.medianCompletionDays}
                        </td>
                        <td className="p-2 text-typography-700">{row.inProgressStalled}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              offset={offset}
              shown={table.data.length}
              total={table.count}
              onChange={setOffset}
            />
          </div>
        )}
      </StatCard>
    </div>
  );
};

// ── Shared bars ─────────────────────────────────────────────────

const Bars = ({
  rows,
}: {
  rows: Array<{ key: string; label: string; count: number; colour: string; suffix?: string }>;
}) => {
  const top = Math.max(1, ...rows.map(r => r.count));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(row => (
        <li key={row.key} className="flex items-center gap-3 text-sm">
          <span className="flex-[0_0_38%] truncate text-typography-900">{row.label}</span>
          <span className="h-3 flex-1 rounded-md bg-[#efebe0]">
            <span
              className="block h-3 rounded-md"
              style={{ width: `${(row.count / top) * 100}%`, background: row.colour }}
            />
          </span>
          <span className="flex-[0_0_64px] text-right font-semibold text-typography-900">
            {row.count}
            {row.suffix ? ` ${row.suffix}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
};

// ── TSQ-014 Courses in use and idle ────────────────────────────

const CoursesInUse = ({ data }: DataRendererProps<CoursesInUseData>) => {
  const { t } = useTranslation();
  if (data.total === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.courses.none")}</p>;
  }
  const parts = [
    { key: "inUse", count: data.inUse, colour: "#2a5db0" },
    { key: "idle", count: data.idle, colour: "#8f8a7e" },
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="statistics-courses-in-use">
      <div
        className="flex h-7 gap-0.5 overflow-hidden rounded-md"
        role="img"
        aria-label={parts
          .map(p => `${t(`statisticsLibrary.courses.${p.key}`)} ${p.count}`)
          .join(", ")}
      >
        {parts
          .filter(p => p.count > 0)
          .map(p => (
            <div
              key={p.key}
              style={{ width: `${(p.count / data.total) * 100}%`, background: p.colour }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        {parts.map(p => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: p.colour }} />
            {t(`statisticsLibrary.courses.${p.key}`)}{" "}
            <strong className="font-semibold">{p.count}</strong>
          </li>
        ))}
      </ul>
      {data.truncated && (
        <p className="text-xs text-typography-500">
          {t("statisticsLibrary.courses.truncated", { count: data.total })}
        </p>
      )}
    </div>
  );
};

const coursesInUseTakeaway = (data: CoursesInUseData, t: TFunction) =>
  data.total > 0
    ? t("statisticsLibrary.takeaway.coursesInUse", {
        inUse: data.inUse,
        total: data.total,
        idle: data.idle,
      })
    : null;

// ── TSQ-015 / TSQ-016 Courses ranked ───────────────────────────

const makeCourseRanking = (noneKey: string, colour: string) =>
  function CourseRanking({ data }: DataRendererProps<CourseRankingData>) {
    const { t } = useTranslation();
    if (data.rows.length === 0) {
      return <p className="text-sm text-typography-600">{t(noneKey)}</p>;
    }
    return (
      <div data-testid="statistics-course-ranking">
        <Bars
          rows={data.rows.map(r => ({
            key: r.id,
            label: r.title,
            count: r.count,
            colour,
          }))}
        />
      </div>
    );
  };

const StalledCourses = makeCourseRanking("statisticsLibrary.stalled.none", "#b4490a");
const NotStartedCourses = makeCourseRanking("statisticsLibrary.notStarted.none", "#c98a1b");

const stalledTakeaway = (data: CourseRankingData, t: TFunction) =>
  data.rows[0]
    ? t("statisticsLibrary.takeaway.stalled", {
        title: data.rows[0].title,
        count: data.rows[0].count,
      })
    : null;

const notStartedTakeaway = (data: CourseRankingData, t: TFunction) =>
  data.rows[0]
    ? t("statisticsLibrary.takeaway.notStarted", {
        title: shorten(data.rows[0].title),
        count: data.rows[0].count,
      })
    : null;

// ── TSQ-017 Course completion funnel ───────────────────────────

const CourseFunnel = ({ data }: DataRendererProps<CourseFunnelData>) => {
  const { t } = useTranslation();
  const assigned = data.stages[0]?.count ?? 0;
  if (assigned === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.funnel.none")}</p>;
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="statistics-course-funnel">
      {data.stages.map((stage, index) => {
        const pct = Math.round((stage.count / assigned) * 100);
        return (
          <li key={stage.key} className="flex items-center gap-3 text-sm">
            <span className="flex-[0_0_88px] text-typography-900">
              {t(`statisticsLibrary.funnel.${stage.key}`)}
            </span>
            <span className="h-6 flex-1 rounded bg-[#efebe0]">
              <span
                className="block h-6 rounded"
                style={{
                  width: `${pct}%`,
                  background: stage.key === "completed" ? "#1e6b3a" : "#2a5db0",
                }}
              />
            </span>
            <span className="flex-[0_0_120px] text-right">
              <strong className="font-semibold text-typography-900">{stage.count}</strong>
              {index > 0 && (
                <span className="ml-1 text-typography-600">
                  {t("statisticsLibrary.funnel.ofAssigned", { percent: pct })}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const courseFunnelTakeaway = (data: CourseFunnelData, t: TFunction) => {
  const assigned = data.stages[0]?.count ?? 0;
  if (assigned === 0) return null;
  const completed = data.stages[3]?.count ?? 0;
  return t("statisticsLibrary.takeaway.funnel", {
    assigned,
    completed,
    percent: Math.round((completed / assigned) * 100),
  });
};

// ── TSQ-020 Session scores ─────────────────────────────────────

const BIN_LABELS = ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90"];

const ScoreDistribution = ({ data }: DataRendererProps<ScoreDistributionData>) => {
  const { t } = useTranslation();
  if (data.sessions === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.scores.none")}</p>;
  }
  const top = Math.max(1, ...data.bins);
  return (
    <div className="flex flex-col gap-1" data-testid="statistics-score-distribution">
      <div
        className="flex h-36 items-end gap-1.5 border-b border-[#cfc9bb]"
        role="img"
        aria-label={data.bins.map((n, i) => `${BIN_LABELS[i]}: ${n}`).join(", ")}
      >
        {data.bins.map((n, i) => (
          <div
            key={BIN_LABELS[i]}
            title={`${BIN_LABELS[i]} to ${i === 9 ? 100 : Number(BIN_LABELS[i]) + 9}: ${n}`}
            className="flex-1 rounded-t"
            style={{
              height: `${(n / top) * 100}%`,
              background: i < 4 ? "#b4490a" : "#2a5db0",
              minHeight: n > 0 ? 2 : 0,
            }}
          />
        ))}
      </div>
      <div className="flex gap-1.5 text-[11px] text-typography-600">
        {BIN_LABELS.map(label => (
          <span key={label} className="flex-1 text-center">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};

const scoreDistributionTakeaway = (data: ScoreDistributionData, t: TFunction) =>
  data.sessions > 0 && data.median !== null
    ? t("statisticsLibrary.takeaway.scores", { median: data.median, count: data.sessions })
    : null;

// ── TSQ-021 Improving, holding or declining ────────────────────

const TREND_PARTS = [
  { key: "improving", colour: "#1e6b3a" },
  { key: "holding", colour: "#8f8a7e" },
  { key: "declining", colour: "#b4490a" },
] as const;

const LearnerTrends = ({ data }: DataRendererProps<LearnerTrendData>) => {
  const { t } = useTranslation();
  if (data.total === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.trends.none")}</p>;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="statistics-learner-trends">
      <div
        className="flex h-7 gap-0.5 overflow-hidden rounded-md"
        role="img"
        aria-label={TREND_PARTS.map(
          p => `${t(`statisticsLibrary.trends.${p.key}`)} ${data[p.key]}`,
        ).join(", ")}
      >
        {TREND_PARTS.filter(p => data[p.key] > 0).map(p => (
          <div
            key={p.key}
            style={{ width: `${(data[p.key] / data.total) * 100}%`, background: p.colour }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        {TREND_PARTS.map(p => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: p.colour }} />
            {t(`statisticsLibrary.trends.${p.key}`)}{" "}
            <strong className="font-semibold">{data[p.key]}</strong>
          </li>
        ))}
      </ul>
      <p className="text-xs text-typography-500">
        {t("statisticsLibrary.trends.rule", { points: data.threshold })}
      </p>
    </div>
  );
};

const learnerTrendsTakeaway = (data: LearnerTrendData, t: TFunction) =>
  data.total > 0
    ? t("statisticsLibrary.takeaway.trends", { improving: data.improving, total: data.total })
    : null;

// ── TSQ-022 Hardest and easiest scenarios ──────────────────────

const ScenarioScores = ({ data }: DataRendererProps<ScenarioScoresData>) => {
  const { t } = useTranslation();
  if (data.rows.length === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.scenarios.none")}</p>;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="statistics-scenario-scores">
      <p className="text-xs text-typography-500">{t("statisticsLibrary.scenarios.order")}</p>
      <ul className="flex flex-col gap-3">
        {data.rows.map(row => (
          <li key={row.scenarioId} className="flex items-center gap-3 text-sm">
            <span className="flex-[0_0_44%] truncate text-typography-900" title={row.title}>
              {row.title}
            </span>
            <span className="h-3 flex-1 rounded-md bg-[#efebe0]">
              <span
                className="block h-3 rounded-md"
                style={{
                  width: `${row.averageScore}%`,
                  background: row.averageScore < 60 ? "#b4490a" : "#2a5db0",
                }}
              />
            </span>
            <span className="flex-[0_0_120px] whitespace-nowrap text-right text-typography-700">
              <strong className="font-semibold text-typography-900">{row.averageScore}</strong>{" "}
              {t("statisticsLibrary.scenarios.sessions", { count: row.sessions })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const scenarioScoresTakeaway = (data: ScenarioScoresData, t: TFunction) => {
  if (data.rows.length === 0) return null;
  const hardest = data.rows[0];
  const easiest = data.rows[data.rows.length - 1];
  if (hardest.scenarioId === easiest.scenarioId) {
    return t("statisticsLibrary.takeaway.scenarioOne", {
      title: shorten(hardest.title),
      score: hardest.averageScore,
    });
  }
  return t("statisticsLibrary.takeaway.scenarios", {
    hardest: shorten(hardest.title),
    hardScore: hardest.averageScore,
    easiest: shorten(easiest.title),
    easyScore: easiest.averageScore,
  });
};

// ── TSQ-026 Ratings ────────────────────────────────────────────

const Ratings = ({ data }: DataRendererProps<RatingsData>) => {
  const { t } = useTranslation();
  if (data.count === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.ratings.none")}</p>;
  }
  const top = Math.max(1, ...data.stars);
  return (
    <div className="flex flex-col gap-3" data-testid="statistics-ratings">
      <p className="font-secondary text-4xl font-semibold text-typography-900">
        {data.average?.toFixed(1)}
        <span className="ml-1 text-sm font-normal text-typography-600">
          {t("statisticsLibrary.ratings.outOfFive")}
        </span>
      </p>
      <ul className="flex flex-col gap-2">
        {[5, 4, 3, 2, 1].map(star => (
          <li key={star} className="flex items-center gap-3 text-sm">
            <span className="w-14 text-typography-700">
              {t("statisticsLibrary.ratings.stars", { count: star })}
            </span>
            <span className="h-3 flex-1 rounded-md bg-[#efebe0]">
              <span
                className="block h-3 rounded-md bg-[#2a5db0]"
                style={{ width: `${(data.stars[star - 1] / top) * 100}%` }}
              />
            </span>
            <span className="w-10 text-right font-semibold text-typography-900">
              {data.stars[star - 1]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const ratingsTakeaway = (data: RatingsData, t: TFunction) =>
  data.count > 0 && data.average !== null
    ? t("statisticsLibrary.takeaway.ratings", {
        average: data.average.toFixed(1),
        count: data.count,
      })
    : null;

// ── TSQ-027 Sessions reviewed ──────────────────────────────────

const ReviewCoverage = ({ data }: DataRendererProps<ReviewCoverageData>) => {
  const { t } = useTranslation();
  if (data.completedSessions === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.reviews.none")}</p>;
  }
  const pct = Math.round((data.reviewedSessions / data.completedSessions) * 100);
  return (
    <div className="flex flex-col gap-3" data-testid="statistics-review-coverage">
      <p className="font-secondary text-4xl font-semibold text-typography-900">
        {data.reviewedSessions}
        <span className="ml-1 text-sm font-normal text-typography-600">
          {t("statisticsLibrary.reviews.ofCompleted", { total: data.completedSessions })}
        </span>
      </p>
      <span
        className="h-3 rounded-md bg-[#efebe0]"
        role="img"
        aria-label={t("statisticsLibrary.reviews.percent", { percent: pct })}
      >
        <span className="block h-3 rounded-md bg-[#1e6b3a]" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
};

const reviewCoverageTakeaway = (data: ReviewCoverageData, t: TFunction) =>
  data.completedSessions > 0
    ? t("statisticsLibrary.takeaway.reviews", {
        reviewed: data.reviewedSessions,
        total: data.completedSessions,
      })
    : null;

// ── TSQ-005 Practice by weekday and hour ───────────────────────

const HOUR_BANDS = [0, 3, 6, 9, 12, 15, 18, 21];
const HEAT_RAMP = ["#eaf0fa", "#bcd0ee", "#7fa3d9", "#3f73c2", "#1d4a94"];

/** Short weekday names in the page language: 1 January 2024 was a Monday. */
const weekdayNames = (language: string): string[] =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(language, { weekday: "short" }),
  );

const PracticeHeatmap = ({ data }: DataRendererProps<PracticeHeatmapData>) => {
  const { t, i18n } = useTranslation();
  if (data.sessions === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.heatmap.none")}</p>;
  }
  const days = weekdayNames(i18n.language);
  const top = Math.max(1, ...data.cells.flat());
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / top) * 4)));
  return (
    <div className="flex flex-col gap-2" data-testid="statistics-practice-heatmap">
      <div className="grid grid-cols-[56px_repeat(8,minmax(0,1fr))] gap-1 text-[11px] text-typography-600">
        <span />
        {HOUR_BANDS.map(h => (
          <span key={h} className="text-center">
            {h}
          </span>
        ))}
        {data.cells.map((row, d) => (
          <div key={days[d]} className="contents">
            <span className="self-center text-xs text-typography-700">{days[d]}</span>
            {row.map((n, b) => (
              <span
                key={HOUR_BANDS[b]}
                title={t("statisticsLibrary.heatmap.cell", {
                  day: days[d],
                  from: HOUR_BANDS[b],
                  to: HOUR_BANDS[b] + 3,
                  count: n,
                })}
                className="h-7 rounded"
                style={{ background: HEAT_RAMP[level(n)] }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-typography-600">
        {t("statisticsLibrary.heatmap.fewer")}
        {HEAT_RAMP.map(colour => (
          <span key={colour} className="h-3.5 w-3.5 rounded-sm" style={{ background: colour }} />
        ))}
        {t("statisticsLibrary.heatmap.more")}
      </div>
      <p className="text-xs text-typography-500">
        {t("statisticsLibrary.heatmap.timezone", { timezone: data.timezone })}
      </p>
    </div>
  );
};

const practiceHeatmapTakeaway = (data: PracticeHeatmapData, t: TFunction) => {
  if (data.sessions === 0) return null;
  let best = { d: 0, b: 0, n: -1 };
  data.cells.forEach((row, d) =>
    row.forEach((n, b) => {
      if (n > best.n) best = { d, b, n };
    }),
  );
  const language =
    typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
  const day = new Date(2024, 0, 1 + best.d).toLocaleDateString(language, { weekday: "long" });
  return t("statisticsLibrary.takeaway.heatmap", {
    day,
    from: HOUR_BANDS[best.b],
    to: HOUR_BANDS[best.b] + 3,
  });
};

// ── TSQ-006 Session length ─────────────────────────────────────

const SessionLength = ({ data }: DataRendererProps<SessionLengthData>) => {
  const { t } = useTranslation();
  if (data.sessions === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.length.none")}</p>;
  }
  const bounds = data.boundsMinutes;
  const label = (i: number) => {
    if (i === 0) return t("statisticsLibrary.length.under", { max: bounds[0] });
    if (i === bounds.length) return t("statisticsLibrary.length.over", { min: bounds[i - 1] });
    return t("statisticsLibrary.length.between", { min: bounds[i - 1], max: bounds[i] });
  };
  return (
    <div data-testid="statistics-session-length">
      <Bars
        rows={data.bins.map((count, i) => ({
          key: String(i),
          label: label(i),
          count,
          colour: "#2a5db0",
        }))}
      />
    </div>
  );
};

const sessionLengthTakeaway = (data: SessionLengthData, t: TFunction) =>
  data.sessions > 0 && data.medianMinutes !== null
    ? t("statisticsLibrary.takeaway.length", {
        median: data.medianMinutes,
        count: data.sessions,
      })
    : null;

// ── TSQ-011 Activation funnel ──────────────────────────────────

const Activation = ({ data }: DataRendererProps<ActivationData>) => {
  const { t } = useTranslation();
  const registered = data.stages[0]?.count ?? 0;
  if (registered === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.activation.none")}</p>;
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="statistics-activation">
      {data.stages.map((stage, index) => {
        const pct = Math.round((stage.count / registered) * 100);
        return (
          <li key={stage.key} className="flex items-center gap-3 text-sm">
            <span className="flex-[0_0_42%] text-typography-900">
              {t(`statisticsLibrary.activation.${stage.key}`)}
            </span>
            <span className="h-6 flex-1 rounded bg-[#efebe0]">
              <span
                className="block h-6 rounded"
                style={{
                  width: `${pct}%`,
                  background: index === data.stages.length - 1 ? "#1e6b3a" : "#2a5db0",
                }}
              />
            </span>
            <span className="flex-[0_0_56px] text-right font-semibold text-typography-900">
              {stage.count}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const activationTakeaway = (data: ActivationData, t: TFunction) => {
  const registered = data.stages[0]?.count ?? 0;
  if (registered === 0) return null;
  return t("statisticsLibrary.takeaway.activation", {
    started: data.stages[1]?.count ?? 0,
    registered,
    recent: data.stages[3]?.count ?? 0,
  });
};

// ── TSQ-012 Regular and bursty practice ────────────────────────

const REGULARITY_PARTS = [
  { key: "regular", colour: "#2a5db0" },
  { key: "occasional", colour: "#c98a1b" },
  { key: "bursty", colour: "#8f8a7e" },
] as const;

const Regularity = ({ data }: DataRendererProps<RegularityData>) => {
  const { t } = useTranslation();
  if (data.total === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.regularity.none")}</p>;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="statistics-regularity">
      <div
        className="flex h-7 gap-0.5 overflow-hidden rounded-md"
        role="img"
        aria-label={REGULARITY_PARTS.map(
          p => `${t(`statisticsLibrary.regularity.${p.key}`)} ${data[p.key]}`,
        ).join(", ")}
      >
        {REGULARITY_PARTS.filter(p => data[p.key] > 0).map(p => (
          <div
            key={p.key}
            style={{ width: `${(data[p.key] / data.total) * 100}%`, background: p.colour }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        {REGULARITY_PARTS.map(p => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: p.colour }} />
            {t(`statisticsLibrary.regularity.${p.key}`)}{" "}
            <strong className="font-semibold">{data[p.key]}</strong>
          </li>
        ))}
      </ul>
      <p className="text-xs text-typography-500">
        {t("statisticsLibrary.regularity.rule", { weeks: data.weeks })}
      </p>
    </div>
  );
};

const regularityTakeaway = (data: RegularityData, t: TFunction) =>
  data.total > 0
    ? t("statisticsLibrary.takeaway.regularity", {
        regular: data.regular,
        total: data.total,
        bursty: data.bursty,
      })
    : null;

// ── TSQ-018 Drop-off by item format ────────────────────────────

/** A readable fallback for a kind of item this build has no translation for. */
const humaniseType = (type: string) =>
  type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");

const useItemTypeLabel = () => {
  const { t, i18n } = useTranslation();
  return (type: string) =>
    i18n.exists(`statisticsLibrary.itemTypes.${type}`)
      ? t(`statisticsLibrary.itemTypes.${type}`)
      : humaniseType(type);
};

const ItemFormats = ({ data }: DataRendererProps<ItemFormatData>) => {
  const { t } = useTranslation();
  const typeLabel = useItemTypeLabel();
  if (data.rows.length === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.formats.none")}</p>;
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="statistics-item-formats">
      {data.rows.map(row => (
        <li key={row.type} className="flex flex-col gap-1 text-sm">
          <span className="flex items-center justify-between gap-3">
            <span className="text-typography-900">{typeLabel(row.type)}</span>
            <span className="text-typography-600">
              {t("statisticsLibrary.formats.finished", {
                percent: row.completedPercent,
                completed: row.completed,
                reached: row.reached,
              })}
            </span>
          </span>
          <span className="h-3 rounded-md bg-[#efebe0]">
            <span
              className="block h-3 rounded-md"
              style={{
                width: `${row.completedPercent}%`,
                background: row.completedPercent < 80 ? "#b4490a" : "#1e6b3a",
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
};

const makeItemFormatsTakeaway = () =>
  function itemFormatsTakeaway(data: ItemFormatData, t: TFunction) {
    const worst = data.rows[0];
    if (!worst) return null;
    return t("statisticsLibrary.takeaway.formats", {
      type: t(`statisticsLibrary.itemTypes.${worst.type}`, {
        defaultValue: humaniseType(worst.type),
      }),
      percent: worst.completedPercent,
    });
  };

// ── TSQ-019 Quiz pass rate ─────────────────────────────────────

const QuizPass = ({ data }: DataRendererProps<QuizPassData>) => {
  const { t } = useTranslation();
  if (data.rows.length === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.quiz.none")}</p>;
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="statistics-quiz-pass">
      {data.rows.map(row => (
        <li key={row.title} className="flex flex-col gap-1 text-sm">
          <span className="flex items-center justify-between gap-3">
            <span className="truncate text-typography-900" title={row.title}>
              {row.title}
            </span>
            <span className="flex-none text-typography-600">
              {t("statisticsLibrary.quiz.passed", {
                percent: row.passRatePercent,
                count: row.attempts,
              })}
            </span>
          </span>
          <span className="h-3 rounded-md bg-[#efebe0]">
            <span
              className="block h-3 rounded-md"
              style={{
                width: `${row.passRatePercent}%`,
                background: row.passRatePercent < 50 ? "#b4490a" : "#2a5db0",
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
};

const quizPassTakeaway = (data: QuizPassData, t: TFunction) =>
  data.rows[0]
    ? t("statisticsLibrary.takeaway.quiz", {
        title: shorten(data.rows[0].title),
        percent: data.rows[0].passRatePercent,
        count: data.rows[0].attempts,
      })
    : null;

// ── TSQ-024 Skills before and after ────────────────────────────

/** Skill levels run from 1 to 5. */
const levelPercent = (level: number) => ((level - 1) / 4) * 100;

const SkillChange = ({ data }: DataRendererProps<SkillChangeData>) => {
  const { t, i18n } = useTranslation();
  if (data.rows.length === 0) {
    return <p className="text-sm text-typography-600">{t("statisticsLibrary.skills.none")}</p>;
  }
  const label = (skill: string) =>
    i18n.exists(`statisticsLibrary.skills.names.${skill}`)
      ? t(`statisticsLibrary.skills.names.${skill}`)
      : humaniseType(skill);
  return (
    <div className="flex flex-col gap-3" data-testid="statistics-skill-change">
      <div className="flex flex-wrap gap-4 text-xs text-typography-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-[#2a5db0] bg-white" />
          {t("statisticsLibrary.skills.first")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-[#2a5db0]" />
          {t("statisticsLibrary.skills.latest")}
        </span>
        <span>{t("statisticsLibrary.skills.scale")}</span>
      </div>
      <ul className="flex flex-col gap-3">
        {data.rows.map(row => {
          const from = Math.min(levelPercent(row.first), levelPercent(row.latest));
          const width = Math.abs(levelPercent(row.latest) - levelPercent(row.first));
          const delta = Math.round((row.latest - row.first) * 10) / 10;
          return (
            <li key={row.skill} className="flex items-center gap-3 text-sm">
              <span className="flex-[0_0_120px] truncate text-typography-900">
                {label(row.skill)}
              </span>
              <span className="relative h-4 flex-1">
                <span className="absolute left-0 right-0 top-[7px] h-0.5 bg-[#efebe0]" />
                <span
                  className="absolute top-[7px] h-0.5 bg-[#2a5db0]"
                  style={{ left: `${from}%`, width: `${width}%` }}
                />
                <span
                  className="absolute top-0.5 -ml-1.5 h-3 w-3 rounded-full border-2 border-[#2a5db0] bg-white"
                  style={{ left: `${levelPercent(row.first)}%` }}
                />
                <span
                  className="absolute top-0.5 -ml-1.5 h-3 w-3 rounded-full bg-[#2a5db0]"
                  style={{ left: `${levelPercent(row.latest)}%` }}
                />
              </span>
              <span className="flex-[0_0_48px] text-right font-semibold text-typography-900">
                {delta > 0 ? `+${delta}` : delta}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const skillChangeTakeaway = (data: SkillChangeData, t: TFunction) => {
  if (data.rows.length === 0) return null;
  const weakest = data.rows[0];
  const gainer = data.rows.reduce((best, r) =>
    r.latest - r.first > best.latest - best.first ? r : best,
  );
  const delta = Math.round((gainer.latest - gainer.first) * 10) / 10;
  if (delta < 0.1) return t("statisticsLibrary.takeaway.skillsFlat");
  return t("statisticsLibrary.takeaway.skills", {
    weakest: t(`statisticsLibrary.skills.names.${weakest.skill}`, {
      defaultValue: humaniseType(weakest.skill),
    }),
    level: weakest.latest,
    gain: t(`statisticsLibrary.skills.names.${gainer.skill}`, {
      defaultValue: humaniseType(gainer.skill),
    }),
    delta,
  });
};

export const CHART_RENDERERS: Record<string, ChartRenderer> = {
  "TSQ-001": { kind: "data", Component: HeadlineNumbers, bare: true },
  "TSQ-002": { kind: "data", Component: UsageOverTime, takeaway: usageTakeaway },
  "TSQ-003": { kind: "data", Component: MostUsedSimulations, takeaway: mostUsedTakeaway },
  "TSQ-005": { kind: "data", Component: PracticeHeatmap, takeaway: practiceHeatmapTakeaway },
  "TSQ-006": { kind: "data", Component: SessionLength, takeaway: sessionLengthTakeaway },
  "TSQ-011": { kind: "data", Component: Activation, takeaway: activationTakeaway },
  "TSQ-012": { kind: "data", Component: Regularity, takeaway: regularityTakeaway },
  "TSQ-018": { kind: "data", Component: ItemFormats, takeaway: makeItemFormatsTakeaway() },
  "TSQ-019": { kind: "data", Component: QuizPass, takeaway: quizPassTakeaway },
  "TSQ-024": { kind: "data", Component: SkillChange, takeaway: skillChangeTakeaway },
  "TSQ-007": { kind: "data", Component: LearnerStatus, takeaway: learnerStatusTakeaway },
  "TSQ-008": { kind: "data", Component: TopLearners, takeaway: topLearnersTakeaway },
  "TSQ-009": { kind: "self", Component: LearnerTable },
  "TSQ-013": { kind: "self", Component: CourseTable },
  "TSQ-014": { kind: "data", Component: CoursesInUse, takeaway: coursesInUseTakeaway },
  "TSQ-015": { kind: "data", Component: StalledCourses, takeaway: stalledTakeaway },
  "TSQ-016": { kind: "data", Component: NotStartedCourses, takeaway: notStartedTakeaway },
  "TSQ-017": { kind: "data", Component: CourseFunnel, takeaway: courseFunnelTakeaway },
  "TSQ-020": { kind: "data", Component: ScoreDistribution, takeaway: scoreDistributionTakeaway },
  "TSQ-021": { kind: "data", Component: LearnerTrends, takeaway: learnerTrendsTakeaway },
  "TSQ-022": { kind: "data", Component: ScenarioScores, takeaway: scenarioScoresTakeaway },
  "TSQ-026": { kind: "data", Component: Ratings, takeaway: ratingsTakeaway },
  "TSQ-027": { kind: "data", Component: ReviewCoverage, takeaway: reviewCoverageTakeaway },
  "TSQ-023": { kind: "data", Component: AttentionLearners, takeaway: attentionTakeaway },
};
