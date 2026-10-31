import { useMemo, useState } from "react";

import { useGetCourseUnitsQuery } from "@api";

import { bucketTitle, withoutInProgress } from "./analyticsGrouping";
import { ChartDetailModal } from "./ChartDetailModal";
import { ChartCard, GroupingPicker, buildSource } from "./chartKit";
import { CONTEXT } from "./chartScales";
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
  formatAverage,
  formatUnits,
  niceCeiling,
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

/* Plot geometry, in viewBox units. The SVG scales to the card width. */
const W = 680;
const LEFT = 44;
const RIGHT = 8;
const BAR_MAX = 30;
/** Minimum horizontal room per period before value labels would collide. */
const LABEL_MIN_STEP = 30;
const PANELS = {
  units: { title: 14, top: 30, height: 160 },
  learners: { title: 232, top: 244, height: 60 },
  average: { title: 336, top: 348, height: 56 },
} as const;
const AXIS_Y = 428;
const H = 440;

const INK = "#161616";
const MUTED = "#6f6f6f";
const GRID = "#e0e0e0";

const Label = ({
  x,
  y,
  anchor = "middle",
  size = 11,
  fill = MUTED,
  children,
}: {
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  size?: number;
  fill?: string;
  children: React.ReactNode;
}) => (
  <text x={x} y={y} textAnchor={anchor} fontSize={size} fill={fill}>
    {children}
  </text>
);

/** Rounded data end, square at the baseline. */
const Column = ({
  x,
  y,
  w,
  h,
  fill,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}) => {
  if (h <= 0) return null;
  const r = Math.min(4, w / 2, h);
  return (
    <path
      d={`M${x} ${y + h} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h} Z`}
      fill={fill}
    />
  );
};

/**
 * Three panels on one shared period axis: course units (columns), unique
 * learners behind them (columns), and average units per learner (line). Each
 * panel has its own scale — units run into the thousands and the average sits
 * near 2, so one shared axis would flatten one of them — and the shared x
 * position is what lets a reader go straight down a period.
 */
const CourseUnitsPlot = ({
  points,
  grain,
}: {
  points: CourseUnitsPoint[];
  grain: CourseUnitsGrain;
}) => {
  const n = points.length;
  const step = (W - LEFT - RIGHT) / Math.max(n, 1);
  const bw = Math.min(BAR_MAX, step * 0.6);
  const cx = (i: number) => LEFT + step * i + step / 2;
  const showValues = step >= LABEL_MIN_STEP;
  // Thin the axis so labels never overlap on a long (daily / weekly) axis.
  const every = Math.max(1, Math.ceil(44 / step));

  const unitsMax = niceCeiling(Math.max(...points.flatMap(p => [p.units, p.targetUnits ?? 0]), 0));
  const learnersMax = niceCeiling(Math.max(...points.map(p => p.learners), 0));
  const averages = points.map(p => p.avgUnitsPerLearner).filter((a): a is number => a !== null);
  // A line, not bars, so its scale need not start at zero: pad the observed
  // range so a drift from 2.0 to 2.7 reads as a drift. Every point is labelled.
  const lo = averages.length ? Math.min(...averages) : 0;
  const hi = averages.length ? Math.max(...averages) : 1;
  const avgMin = lo - Math.max(hi - lo, hi * 0.1) * 0.5;
  const avgMax = hi + Math.max(hi - lo, hi * 0.1) * 0.2;

  const { units: U, learners: L, average: A } = PANELS;
  const uy = (v: number) => U.top + U.height - (v / unitsMax) * U.height;
  const ly = (v: number) => L.top + L.height - (v / learnersMax) * L.height;
  const ay = (v: number) => A.top + A.height - ((v - avgMin) / (avgMax - avgMin)) * A.height;

  const line = points.reduce<string[]>((segs, p, i) => {
    if (p.avgUnitsPerLearner === null) return segs;
    const prevBroken = i === 0 || points[i - 1].avgUnitsPerLearner === null;
    segs.push(`${prevBroken ? "M" : "L"}${cx(i)} ${ay(p.avgUnitsPerLearner)}`);
    return segs;
  }, []);

  const baseline = (y: number) => (
    <line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} stroke={CONTEXT.faint} strokeWidth={1} />
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="Three stacked panels sharing a period axis: course units as columns, unique learners as columns, average units per learner as a line"
    >
      <Label x={LEFT} y={U.title} anchor="start" size={12} fill={INK}>
        Course units (XP ÷ {COURSE_UNIT_XP})
      </Label>
      {[0, unitsMax / 2, unitsMax].map(v => (
        <g key={v}>
          <line x1={LEFT} x2={W - RIGHT} y1={uy(v)} y2={uy(v)} stroke={GRID} strokeWidth={0.5} />
          <Label x={LEFT - 6} y={uy(v) + 4} anchor="end">
            {formatUnits(v)}
          </Label>
        </g>
      ))}
      {points.map((p, i) => (
        <g key={p.bucket}>
          <title>{`${p.bucket}: ${formatUnits(p.units)} units${p.targetUnits === null ? "" : ` (target ${formatUnits(p.targetUnits)})`}, ${p.learners} learners, ${formatAverage(p.avgUnitsPerLearner)} per learner`}</title>
          <Column
            x={cx(i) - bw / 2}
            y={uy(p.units)}
            w={bw}
            h={U.top + U.height - uy(p.units)}
            fill={COURSE_UNITS_COLORS.units}
          />
          {showValues && (
            <Label x={cx(i)} y={uy(Math.max(p.units, p.targetUnits ?? 0)) - 8} fill={INK}>
              {formatUnits(p.units)}
            </Label>
          )}
        </g>
      ))}
      {points.map((p, i) =>
        p.targetUnits === null || p.targetUnits <= 0 ? null : (
          <line
            key={p.bucket}
            x1={cx(i) - bw / 2 - 4}
            x2={cx(i) + bw / 2 + 4}
            y1={uy(p.targetUnits)}
            y2={uy(p.targetUnits)}
            stroke={COURSE_UNITS_COLORS.target}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ),
      )}
      {baseline(U.top + U.height)}

      <Label x={LEFT} y={L.title} anchor="start" size={12} fill={INK}>
        Unique learners earning XP
      </Label>
      {points.map((p, i) => (
        <g key={p.bucket}>
          <Column
            x={cx(i) - bw / 2}
            y={ly(p.learners)}
            w={bw}
            h={L.top + L.height - ly(p.learners)}
            fill={COURSE_UNITS_COLORS.learners}
          />
          {showValues && (
            <Label x={cx(i)} y={ly(p.learners) - 5} fill={INK}>
              {p.learners.toLocaleString()}
            </Label>
          )}
        </g>
      ))}
      {baseline(L.top + L.height)}

      <Label x={LEFT} y={A.title} anchor="start" size={12} fill={INK}>
        Average units per learner
      </Label>
      <path
        d={line.join(" ")}
        fill="none"
        stroke={COURSE_UNITS_COLORS.average}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) =>
        p.avgUnitsPerLearner === null ? null : (
          <g key={p.bucket}>
            <circle
              cx={cx(i)}
              cy={ay(p.avgUnitsPerLearner)}
              r={4.5}
              fill={COURSE_UNITS_COLORS.average}
              stroke="#fff"
              strokeWidth={2}
            />
            {showValues && (
              <Label x={cx(i)} y={ay(p.avgUnitsPerLearner) - 10} fill={INK}>
                {formatAverage(p.avgUnitsPerLearner)}
              </Label>
            )}
          </g>
        ),
      )}
      {baseline(A.top + A.height)}

      {points.map((p, i) =>
        i % every === 0 ? (
          <Label key={p.bucket} x={cx(i)} y={AXIS_Y} size={12}>
            {bucketAxisLabel(p.bucket, grain, i === 0)}
          </Label>
        ) : null,
      )}
    </svg>
  );
};

const Legend = () => (
  <div className="mb-2 flex flex-wrap gap-4 text-xs text-typography-500">
    {(
      [
        ["Course units", COURSE_UNITS_COLORS.units],
        ["Target (XP target ÷ 100)", COURSE_UNITS_COLORS.target],
        ["Unique learners", COURSE_UNITS_COLORS.learners],
        ["Avg units per learner", COURSE_UNITS_COLORS.average],
      ] as const
    ).map(([label, color]) => (
      <span key={label} className="flex items-center gap-1">
        <span
          className={`inline-block rounded-sm ${label.startsWith("Target") ? "h-0.5 w-3.5" : "h-2.5 w-2.5"}`}
          style={{ background: color }}
        />
        {label}
      </span>
    ))}
  </div>
);

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
    `÷ ${COURSE_UNIT_XP}, from every XP source. Where an XP target is set for the period (month and year grain), the dark mark on each column is that target ÷ ${COURSE_UNIT_XP} — the same goal as the Utilization chart, not configured twice. Unique learners are the people who earned any ` +
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
        height="440px"
        chartId="AAQ-252"
      >
        <Legend />
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
              <Legend />
              <CourseUnitsPlot points={plotted} grain={grain} />
            </>
          )}
        />
      )}
    </>
  );
};
