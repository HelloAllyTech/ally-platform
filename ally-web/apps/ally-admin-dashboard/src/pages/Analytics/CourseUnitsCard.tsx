import { useMemo, useState } from "react";

import { GroupedBarChart, LineChart } from "@carbon/charts-react";

import { useGetCourseUnitsQuery } from "@api";

import { bucketTitle, withoutInProgress } from "./analyticsGrouping";
import { ChartDetailModal } from "./ChartDetailModal";
import {
  ChartCard,
  ColorScale,
  GroupingPicker,
  buildSource,
  context,
  lineOpts,
  single,
  timeBarOpts,
} from "./chartKit";
import {
  COURSE_UNITS_COLORS,
  COURSE_UNITS_RANGE,
  COURSE_UNIT_XP,
  CourseUnitsGrain,
  CourseUnitsPoint,
  bucketAxisLabel,
  buildCourseUnitsTable,
  courseUnitsEmptyText,
  courseUnitsTakeaway,
} from "./courseUnitsChart";

const EMPTY_POINTS: CourseUnitsPoint[] = [];

const GRAIN_OPTIONS: CourseUnitsGrain[] = ["day", "week", "month", "year"];

const TITLE = "Course units consumed";

const asOfStamp = (computedAt?: string): string | undefined => {
  if (!computedAt) return undefined;
  const d = new Date(computedAt);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const UNITS_GROUP = "Course units";
const TARGET_GROUP = "Target (XP target ÷ 100)";
const LEARNERS_GROUP = "Unique learners";
const AVERAGE_GROUP = "Avg units per learner";

const unitsScale: ColorScale = {
  ...single(UNITS_GROUP, COURSE_UNITS_COLORS.units),
  ...context(TARGET_GROUP),
};

interface Datum {
  group: string;
  key: string;
  value: number;
}

/**
 * One datum per period per panel. A missing target or average is simply absent
 * (never 0): Carbon leaves a gap, which is what "no target set" / "nobody earned
 * XP" looks like on the plot.
 */
const buildSeries = (points: CourseUnitsPoint[], grain: CourseUnitsGrain) => {
  const labels = points.map((p, i) => bucketAxisLabel(p.bucket, grain, i === 0));
  // The short labels repeat across a long axis (a year grain, or months spanning
  // two Januaries); fall back to the full date so no two periods share a tick.
  const unique = new Set(labels).size === labels.length;
  const key = (i: number) => (unique ? labels[i] : points[i].bucket);

  const units: Datum[] = [
    ...points.map((p, i) => ({ group: UNITS_GROUP, key: key(i), value: p.units })),
    ...points.flatMap((p, i) =>
      p.targetUnits === null || p.targetUnits <= 0
        ? []
        : [{ group: TARGET_GROUP, key: key(i), value: p.targetUnits }],
    ),
  ];
  const learners: Datum[] = points.map((p, i) => ({
    group: LEARNERS_GROUP,
    key: key(i),
    value: p.learners,
  }));
  const average: Datum[] = points.flatMap((p, i) =>
    p.avgUnitsPerLearner === null
      ? []
      : [{ group: AVERAGE_GROUP, key: key(i), value: p.avgUnitsPerLearner }],
  );
  return { units, learners, average };
};

/**
 * Three Carbon charts on one shared period axis: course units (columns, with the
 * target beside them), unique learners (columns), and average units per learner
 * (a line). Each has its own value axis — units run into the thousands and the
 * average sits near 2, so one shared axis would flatten one of them.
 */
const CourseUnitsPlot = ({
  points,
  grain,
  expanded = false,
}: {
  points: CourseUnitsPoint[];
  grain: CourseUnitsGrain;
  expanded?: boolean;
}) => {
  const series = useMemo(() => buildSeries(points, grain), [points, grain]);
  const bottomTitle = bucketTitle(grain);

  const unitsOpts = useMemo(
    () =>
      timeBarOpts({
        leftTitle: "Course units",
        bottomTitle,
        colorScale: unitsScale,
        legend: true,
        height: expanded ? "340px" : "260px",
      }),
    [bottomTitle, expanded],
  );
  const learnersOpts = useMemo(
    () =>
      timeBarOpts({
        leftTitle: "Unique learners",
        bottomTitle,
        colorScale: single(LEARNERS_GROUP, COURSE_UNITS_COLORS.learners),
        height: expanded ? "260px" : "200px",
      }),
    [bottomTitle, expanded],
  );
  const averageOpts = useMemo(
    () =>
      lineOpts({
        leftTitle: "Avg units per learner",
        bottomTitle,
        colorScale: single(AVERAGE_GROUP, COURSE_UNITS_COLORS.average),
        legend: false,
        height: expanded ? "260px" : "200px",
      }),
    [bottomTitle, expanded],
  );

  return (
    <div className="flex flex-col gap-4">
      <GroupedBarChart data={series.units} options={unitsOpts} />
      <GroupedBarChart data={series.learners} options={learnersOpts} />
      <LineChart data={series.average} options={averageOpts} />
    </div>
  );
};

/**
 * Course units consumed per period, the learners they came from, and the
 * average per learner — one read of "is usage growing because more people
 * come, or because the same people do more".
 *
 * A course unit is {@link COURSE_UNIT_XP} XP, so units = XP earned / 100, over
 * ALL XP sources. A learner counts in a period when they earned XP in it.
 * Platform-wide (no tenant filter), grain-only control like its Goals-tab
 * siblings; the grain picks the window ({@link COURSE_UNITS_RANGE}). The
 * still-accruing period is left off the plot, like every per-period chart on
 * this tab, and shown flagged in the expanded table.
 */
export const CourseUnitsCard = () => {
  const [grain, setGrain] = useState<CourseUnitsGrain>("month");
  const { data, isLoading, isError, refetch } = useGetCourseUnitsQuery({
    bucket: grain,
    range: COURSE_UNITS_RANGE[grain],
  });
  const [expanded, setExpanded] = useState(false);

  const allPoints = data?.points ?? EMPTY_POINTS;
  const inProgressBucket = data?.window.inProgressBucket;
  const plotted = useMemo(
    () => withoutInProgress(allPoints, p => p.bucket, inProgressBucket),
    [allPoints, inProgressBucket],
  );
  const table = useMemo(
    () => buildCourseUnitsTable(allPoints, inProgressBucket),
    [allPoints, inProgressBucket],
  );
  const emptyText = courseUnitsEmptyText(plotted);
  const takeaway = courseUnitsTakeaway(
    allPoints,
    inProgressBucket,
    bucketTitle(grain).toLowerCase(),
  );

  const caption =
    `A course unit is ${COURSE_UNIT_XP} XP, so units are the XP learners earned in the period ` +
    `÷ ${COURSE_UNIT_XP}, from every XP source. Where an XP target is set for the period (month and year grain), the grey column beside each period's units is that target ÷ ${COURSE_UNIT_XP} — the same goal as the Utilization chart, not configured twice. Unique learners are the people who earned any ` +
    `XP in that period; the average is units ÷ learners. Units rising with learners flat means ` +
    `a few people are doing more. Platform-wide, no tenant filter. The current ` +
    `${bucketTitle(grain).toLowerCase()} is still accruing and is left off the plot.`;

  const source = buildSource({
    derivation: `SUM(xp_events.xp) ÷ ${COURSE_UNIT_XP}; target = analytics_xp_goals.targetXp ÷ ${COURSE_UNIT_XP}; COUNT(DISTINCT learners with XP) per period`,
    window: data?.window.label,
    n: plotted.length,
    nUnit: "periods shown",
    extra: "Platform-wide — no tenant scope",
    asOf: asOfStamp(data?.computedAt),
  });

  return (
    <>
      <ChartCard
        wide
        title={TITLE}
        caption={caption}
        collapseMeta
        takeaway={takeaway}
        source={source}
        loading={isLoading && !data}
        error={isError}
        onRetry={refetch}
        empty={!isLoading && Boolean(emptyText)}
        emptyText={emptyText}
        controls={
          <GroupingPicker
            id="course-units-grain"
            value={grain}
            onChange={g => setGrain(g as CourseUnitsGrain)}
            options={GRAIN_OPTIONS}
          />
        }
        onExpand={() => setExpanded(true)}
        height="660px"
        chartId="AAQ-252"
      >
        <CourseUnitsPlot points={plotted} grain={grain} />
      </ChartCard>

      {expanded && (
        <ChartDetailModal
          open={expanded}
          onClose={() => setExpanded(false)}
          title={TITLE}
          caption={`Exact per-period figures, including the current ${bucketTitle(grain).toLowerCase()}, flagged as still accruing.`}
          source={source}
          table={table}
          exportContext={[
            `Grouped by ${bucketTitle(grain).toLowerCase()}`,
            `1 course unit = ${COURSE_UNIT_XP} XP`,
          ]}
          render={() => (
            <>
              <CourseUnitsPlot points={plotted} grain={grain} expanded />
            </>
          )}
        />
      )}
    </>
  );
};
