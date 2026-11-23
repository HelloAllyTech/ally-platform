import { ComponentType, createContext, useContext, useMemo, useState } from "react";

import { LineChart } from "@carbon/charts-react";
import { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { useGetStatisticsChartQuery } from "@api";
import type {
  AttentionLearnersData,
  CourseTableData,
  HeadlineNumbersData,
  LearnerStatusCountsData,
  LearnerTableData,
  MostUsedSimulationsData,
  OrganizationMetricsRange,
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

  const tiles: Array<{ key: string; label: string; value: string; unit?: string; note: string }> = [
    {
      key: "active",
      label: t("statisticsLibrary.headline.activeLearners"),
      value: data.activeUsers.toLocaleString(),
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
        title: data[0].title,
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

export const CHART_RENDERERS: Record<string, ChartRenderer> = {
  "TSQ-001": { kind: "data", Component: HeadlineNumbers, bare: true },
  "TSQ-002": { kind: "data", Component: UsageOverTime, takeaway: usageTakeaway },
  "TSQ-003": { kind: "data", Component: MostUsedSimulations, takeaway: mostUsedTakeaway },
  "TSQ-007": { kind: "data", Component: LearnerStatus, takeaway: learnerStatusTakeaway },
  "TSQ-008": { kind: "data", Component: TopLearners, takeaway: topLearnersTakeaway },
  "TSQ-009": { kind: "self", Component: LearnerTable },
  "TSQ-013": { kind: "self", Component: CourseTable },
  "TSQ-023": { kind: "data", Component: AttentionLearners, takeaway: attentionTakeaway },
};
