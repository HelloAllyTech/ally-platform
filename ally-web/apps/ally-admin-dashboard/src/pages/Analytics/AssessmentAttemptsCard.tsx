import { useMemo } from "react";

import { ScaleTypes } from "@carbon/charts";

import { useGetAssessmentAttemptsQuery } from "@api";
import { ComboChart } from "@components/charts";

import {
  ASSESSMENT_ATTEMPTS_NOTE,
  SHARE_GROUP,
  UNITS_GROUP,
  assessmentAttemptsEmptyText,
  assessmentAttemptsTakeaway,
  buildAssessmentAttemptsSeries,
  formatPerUnit,
  formatShare,
} from "./assessmentAttemptsChart";
import { ChartCard, KpiTile, PALETTE, buildSource, comboOpts, context, single } from "./chartKit";

const TITLE = "Single valid assessment attempts";

const colorScale = { ...context(UNITS_GROUP), ...single(SHARE_GROUP, PALETTE.blue) };

/**
 * Do learners get through an assessment roleplay in one valid attempt? A unit is
 * one learner on one assessment roleplay; it counts as "single" when it has
 * exactly one valid attempt (minimum learner turns met) and no trainer reopen.
 *
 * Weekly share (line, right axis) over the units behind it (bars, left axis):
 * the share is units-derived, so the bars carry the sample size a reader needs.
 * The KPI tiles give the all-time share and the incomplete starts per unit, which
 * sit beside the share and are never subtracted from it. Platform-wide, all-time.
 */
export const AssessmentAttemptsCard = () => {
  const { data, isLoading, isError, refetch } = useGetAssessmentAttemptsQuery();

  const series = useMemo(() => buildAssessmentAttemptsSeries(data), [data]);
  const emptyText = assessmentAttemptsEmptyText(data);

  const opts = useMemo(
    () =>
      comboOpts({
        barGroup: UNITS_GROUP,
        lineGroup: SHARE_GROUP,
        leftTitle: "Units",
        rightTitle: "Single valid attempt (%)",
        bottomTitle: "Week of first valid attempt",
        colorScale,
        height: "300px",
        extra: {
          axes: {
            left: {
              mapsTo: "value",
              scaleType: ScaleTypes.LINEAR,
              title: "Units",
              includeZero: true,
              main: true,
              correspondingDatasets: [UNITS_GROUP],
            },
            right: {
              mapsTo: "value",
              scaleType: ScaleTypes.LINEAR,
              title: "Single valid attempt (%)",
              domain: [0, 100],
              correspondingDatasets: [SHARE_GROUP],
            },
            bottom: {
              mapsTo: "key",
              scaleType: ScaleTypes.LABELS,
              title: "Week of first valid attempt",
            },
          },
        },
      }),
    [],
  );

  const caption =
    `A unit is one learner on one assessment roleplay. It counts as a single valid attempt ` +
    `when the learner has exactly one attempt that met the minimum learner turns and no trainer ` +
    `reopened it. Incomplete starts (attempts that stopped short) are shown beside the share, ` +
    `never subtracted from it. Platform-wide and all-time.`;

  const source = buildSource({
    derivation:
      "units with exactly one valid attempt and no reopen / units with at least one valid attempt, by week of first valid attempt",
    window: "All time",
    n: data?.totals.units,
    nUnit: "units",
    extra: "Platform-wide, no tenant scope",
  });

  return (
    <ChartCard
      wide
      title={TITLE}
      caption={caption}
      collapseMeta
      takeaway={assessmentAttemptsTakeaway(data)}
      source={source}
      loading={isLoading && !data}
      error={isError}
      onRetry={refetch}
      empty={!isLoading && !isError && Boolean(emptyText)}
      emptyText={emptyText}
      chartId="AAQ-255"
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiTile
            label="All-time single valid attempt share"
            description="Units with exactly one valid attempt and no reopen, over all units."
            value={formatShare(data?.totals.share)}
            n={data?.totals.units}
            nUnit="units"
          />
          <KpiTile
            label="Incomplete starts per unit"
            description="Short attempts that were restarted, per learner and assessment."
            value={formatPerUnit(data?.totals.incompleteStartsPerUnit)}
            n={data?.totals.incompleteStarts}
            nUnit="incomplete starts"
          />
        </div>
        <ComboChart data={series} options={opts as never} />
        <p className="text-xs text-typography-500">{ASSESSMENT_ATTEMPTS_NOTE}</p>
      </div>
    </ChartCard>
  );
};
