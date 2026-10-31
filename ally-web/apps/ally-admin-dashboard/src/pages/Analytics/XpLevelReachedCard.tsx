import { useMemo, useState } from "react";

import { GroupedBarChart } from "@carbon/charts-react";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import { useGetXpLevelReachedQuery } from "@api";

import { withoutInProgress } from "./analyticsGrouping";
import { ChartDetailModal } from "./ChartDetailModal";
import {
  ChartCard,
  ScrollableChart,
  buildSource,
  integerTickValues,
  timeBarOpts,
} from "./chartKit";
import {
  XP_LEVEL_RANGE_SIZE,
  XpLevelRange,
  XpLevelReachedBucket,
  buildXpLevelReachedSeries,
  buildXpLevelReachedTable,
  pointsInLevelRange,
  xpLevelRanges,
  xpLevelReachedEmptyText,
  xpLevelReachedScale,
  xpLevelReachedTakeaway,
} from "./xpLevelReachedChart";

const EMPTY_POINTS = [];

const asOfStamp = (computedAt?: string): string | undefined => {
  if (!computedAt) return undefined;
  const d = new Date(computedAt);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/**
 * Grains this chart offers — day/week/month/quarter/year, matching the
 * ally-be endpoint's accepted `bucket` values. `quarter` is genuinely useful
 * here (unlike the sibling Goals charts): the level ladder is sparse at the
 * top, so a coarser read is often the only one with anything to show past
 * the first couple of levels. The shared `GroupingPicker`/`AnalyticsBucket`
 * (day/week/month/year only) can't express that, so this card owns a small
 * local Dropdown instead — the same pattern `GoalsXpCard` uses for its own
 * month/quarter/year grain, which the shared control also doesn't cover.
 */
const GRAIN_ITEMS: { key: XpLevelReachedBucket; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

const grainLabel = (grain: XpLevelReachedBucket): string =>
  GRAIN_ITEMS.find(i => i.key === grain)?.label ?? "Week";

const LEVEL_RANGES = xpLevelRanges();

const DEFAULT_LEVELS = Array.from({ length: XP_LEVEL_RANGE_SIZE }, (_, i) => i + 1);

const TITLE = "New Levels Reached per Period";

/**
 * Learners reaching each XP level for the first time, per period — the flow
 * behind the level ladder ("how many L3s did we produce this month"), as
 * distinct from a stock reading of who holds each rung right now.
 *
 * Grouped bars, one series per level: nested, not stacked, because a learner
 * who crosses several levels in one period is counted once in EACH. These XP
 * levels are the only L-levels on Analytics. The ladder has 50 levels, so the
 * chart plots ten at a time (L1-L10 by default) behind a range picker. Upper
 * levels reading as flat zero lines is EXPECTED here, not a bug: most of the
 * platform sits at L0-L1 today.
 */
export const XpLevelReachedCard = () => {
  const [grain, setGrain] = useState<XpLevelReachedBucket>("month");
  const { data, isLoading, isError, refetch } = useGetXpLevelReachedQuery({ bucket: grain });
  const selectedGrainItem = GRAIN_ITEMS.find(i => i.key === grain) ?? GRAIN_ITEMS[0];
  const [levelRange, setLevelRange] = useState<XpLevelRange>(LEVEL_RANGES[0]);
  const [expanded, setExpanded] = useState(false);

  const allPoints = data?.points ?? EMPTY_POINTS;
  const inProgressBucket = data?.window.inProgressBucket;
  const rangePoints = useMemo(
    () => pointsInLevelRange(allPoints, levelRange),
    [allPoints, levelRange],
  );
  const plottedPoints = useMemo(
    () => withoutInProgress(rangePoints, p => p.bucket, inProgressBucket),
    [rangePoints, inProgressBucket],
  );

  const levels = useMemo(
    () => rangePoints[0]?.levelCounts.map(lc => lc.level) ?? DEFAULT_LEVELS,
    [rangePoints],
  );
  const scale = useMemo(() => xpLevelReachedScale(levels), [levels]);
  const series = useMemo(() => buildXpLevelReachedSeries(plottedPoints), [plottedPoints]);
  const table = useMemo(
    () => buildXpLevelReachedTable(allPoints, inProgressBucket),
    [allPoints, inProgressBucket],
  );
  const emptyText = xpLevelReachedEmptyText(plottedPoints, levelRange.label);
  const takeaway = xpLevelReachedTakeaway(
    allPoints,
    inProgressBucket,
    grainLabel(grain).toLowerCase(),
  );

  const opts = useMemo(
    () =>
      timeBarOpts({
        leftTitle: "Learners",
        bottomTitle: grainLabel(grain),
        colorScale: scale,
        legend: true,
        valueTicks: integerTickValues(Math.max(0, ...series.map(d => d.value ?? 0))),
      }),
    [grain, scale, series],
  );

  const caption =
    `Learners reaching each XP level for the FIRST time, one grouped bar per level per ` +
    `period, ten levels at a time (${levelRange.label} shown). L0-L1 hold most of today's ` +
    `population, so the upper levels reading zero across the whole axis is a fact about ` +
    `the platform's level curve, not missing data. ` +
    `Platform-wide, no tenant filter. ` +
    `The current ${grainLabel(grain).toLowerCase()} is still accruing and is left off ` +
    `the plot.`;

  const source = buildSource({
    derivation: "First crossing of each XP-level threshold, from xp_events",
    window: data?.window.label,
    n: plottedPoints.length,
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
          // `relative` is load-bearing: Carbon's Dropdown renders its open
          // list as an absolutely-positioned child, which escapes a `static`
          // scroll container and inflates an ancestor's scrollHeight into a
          // phantom second scrollbar — see GoalsXpCard/RoadmapDeliveryCard
          // for the same note.
          <div className="relative flex gap-2">
            <div className="w-32">
              <Dropdown
                id="xp-level-reached-range"
                size="sm"
                titleText="Levels"
                hideLabel
                label="Levels"
                items={LEVEL_RANGES}
                selectedItem={levelRange}
                itemToString={item => item?.label ?? ""}
                onChange={({ selectedItem: picked }) => {
                  if (picked) setLevelRange(picked);
                }}
              />
            </div>
            <div className="w-28">
              <Dropdown
                id="xp-level-reached-grain"
                size="sm"
                titleText="Group by"
                hideLabel
                label="Group by"
                items={GRAIN_ITEMS}
                selectedItem={selectedGrainItem}
                itemToString={item => item?.label ?? ""}
                onChange={({ selectedItem: picked }) => {
                  if (picked) setGrain(picked.key);
                }}
              />
            </div>
          </div>
        }
        onExpand={() => setExpanded(true)}
        height="340px"
        chartId="AAQ-007"
      >
        <ScrollableChart data={series}>
          <GroupedBarChart data={series} options={opts} />
        </ScrollableChart>
      </ChartCard>

      {expanded && (
        <ChartDetailModal
          open={expanded}
          onClose={() => setExpanded(false)}
          title={TITLE}
          caption="Exact crossing counts for every level (L1–L50) and period, including the current period, flagged as still accruing."
          source={source}
          table={table}
          exportContext={[
            `Grouped by ${grainLabel(grain).toLowerCase()}`,
            "Nested, not stacked: a learner who crosses several levels in one period is counted once in EACH",
          ]}
          render={({ height }) => (
            <ScrollableChart data={series}>
              <GroupedBarChart data={series} options={{ ...opts, height }} />
            </ScrollableChart>
          )}
        />
      )}
    </>
  );
};
