import { useMemo, useState } from "react";

import { ComboChart } from "@carbon/charts-react";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import { useGetXpLevelReachedQuery } from "@api";

import { withoutInProgress } from "./analyticsGrouping";
import { ChartDetailModal } from "./ChartDetailModal";
import { ChartCard, buildSource, comboOpts, integerTickValues } from "./chartKit";
import {
  DEFAULT_LEVEL_REACH_LEVEL,
  LEVEL_REACH_CUMULATIVE_GROUP,
  LEVEL_REACH_LEVELS,
  LEVEL_REACH_NET_GROUP,
  buildLevelReachRows,
  buildLevelReachSeries,
  buildLevelReachTable,
  levelReachEmptyText,
  levelReachScale,
  levelReachTakeaway,
} from "./levelReachCumulativeChart";
import { levelLabel } from "./xpLevelReachedChart";

const EMPTY_POINTS = [];

const LEVEL_ITEMS = LEVEL_REACH_LEVELS.map(level => ({ level, label: levelLabel(level) }));

const asOfStamp = (computedAt?: string): string | undefined => {
  if (!computedAt) return undefined;
  const d = new Date(computedAt);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/**
 * Unique learners who have ever reached an XP level, month by month (AAQ-253).
 *
 * Monthly and all-time by design: no grain picker. The only control is which
 * level (L1-L5) is shown. Bars are the net addition over the previous month, the
 * line is the running total, each on its own labelled axis (the line is the
 * running total of the bars, which is the one case `comboOpts` allows a second
 * axis for). Reads the same all-time `xp-level-reached` response as AAQ-007; the
 * running sum of first-crossings is the unique cumulative count.
 */
export const LevelReachCumulativeCard = () => {
  const [level, setLevel] = useState<number>(DEFAULT_LEVEL_REACH_LEVEL);
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError, refetch } = useGetXpLevelReachedQuery({
    range: "all",
    bucket: "month",
  });

  const title = `Learners who have reached ${levelLabel(level)}`;
  const inProgressBucket = data?.window.inProgressBucket;

  const rows = useMemo(
    () => buildLevelReachRows(data?.points ?? EMPTY_POINTS, level),
    [data, level],
  );
  const plottedRows = useMemo(
    () => withoutInProgress(rows, r => r.bucket, inProgressBucket),
    [rows, inProgressBucket],
  );
  const series = useMemo(() => buildLevelReachSeries(plottedRows), [plottedRows]);
  const table = useMemo(
    () => buildLevelReachTable(rows, level, inProgressBucket),
    [rows, level, inProgressBucket],
  );
  const emptyText = levelReachEmptyText(rows, level);
  const takeaway = levelReachTakeaway(rows, level, inProgressBucket);

  const opts = useMemo(
    () =>
      comboOpts({
        barGroup: LEVEL_REACH_NET_GROUP,
        lineGroup: LEVEL_REACH_CUMULATIVE_GROUP,
        leftTitle: "Net added in month",
        rightTitle: "Cumulative learners",
        bottomTitle: "Month",
        colorScale: levelReachScale,
        valueTicks: integerTickValues(Math.max(0, ...plottedRows.map(r => r.added))),
        rightTicks: integerTickValues(Math.max(0, ...plottedRows.map(r => r.cumulative))),
      }),
    [plottedRows],
  );

  const caption =
    `Unique learners who have reached ${levelLabel(level)} (${levelLabel(level)} threshold ` +
    `of XP), by month. The line is the cumulative count; the bars are the net addition ` +
    `over the previous month. A learner counts once, in the month they first crossed. ` +
    `Platform-wide, no tenant filter. The current month is still accruing and is left ` +
    `off the plot; it is in the expanded view.`;

  const source = buildSource({
    derivation: `First crossing of the ${levelLabel(level)} XP threshold, summed over months, from xp_events`,
    window: data?.window.label,
    n: plottedRows.length,
    nUnit: "months shown",
    extra: "Platform-wide — no tenant scope",
    asOf: asOfStamp(data?.computedAt),
  });

  const selectedItem = LEVEL_ITEMS.find(i => i.level === level) ?? LEVEL_ITEMS[0];

  return (
    <>
      <ChartCard
        wide
        title={title}
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
          // `relative`: keeps Carbon's open list from inflating an ancestor's
          // scroll height (see XpLevelReachedCard).
          <div className="relative w-28">
            <Dropdown
              id="level-reach-cumulative-level"
              size="sm"
              titleText="Level"
              hideLabel
              label="Level"
              items={LEVEL_ITEMS}
              selectedItem={selectedItem}
              itemToString={item => item?.label ?? ""}
              onChange={({ selectedItem: picked }) => {
                if (picked) setLevel(picked.level);
              }}
            />
          </div>
        }
        onExpand={() => setExpanded(true)}
        height="340px"
        chartId="AAQ-253"
      >
        <ComboChart data={series} options={opts} />
      </ChartCard>

      {expanded && (
        <ChartDetailModal
          open={expanded}
          onClose={() => setExpanded(false)}
          title={title}
          caption="Exact monthly additions and running totals, including the current month, flagged as still accruing."
          source={source}
          table={table}
          exportContext={[
            `Level ${levelLabel(level)}`,
            "Monthly; a learner is counted once, in the month they first reached the level",
          ]}
          render={({ height }) => <ComboChart data={series} options={{ ...opts, height }} />}
        />
      )}
    </>
  );
};
