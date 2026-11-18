import React, { useMemo } from "react";

import { en } from "@constants";
import { DebriefMetricsView } from "@types";

import { MIN_RATE_SAMPLE, headlineNumbers, pctNum } from "./metricsData";
import { TILE_GRID, someCount } from "./metricsShared";
import { KpiTile } from "../../Analytics/chartKit";

export const HeadlineTiles: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
  const t = en.debriefs.metrics.tiles;
  const h = useMemo(() => headlineNumbers(view), [view]);
  return (
    <div className={TILE_GRID} data-testid="metrics-tiles">
      <KpiTile
        label={t.hardFail}
        value={h.hardFail.value == null ? en.debriefs.metrics.none : pctNum(h.hardFail.value)}
        n={h.hardFail.of}
        nUnit={t.debriefsUnit}
        minN={MIN_RATE_SAMPLE}
        delta={h.delta.hardFail}
        deltaSuffix=" pts"
        higherIsBetter={false}
        comparisonLabel={t.vsWeek}
        spark={h.spark.hardFail}
        description={h.hardFail.of ? t.hardFailHelp(h.hardFail.n, h.hardFail.of) : undefined}
      />
      <KpiTile
        label={t.debriefs}
        value={h.debriefs.toLocaleString()}
        spark={someCount(h.spark.debriefs)}
        description={t.debriefsHelp}
      />
      <KpiTile
        label={t.outages}
        value={h.outages.toLocaleString()}
        spark={someCount(h.spark.outages)}
        description={t.outagesHelp}
      />
      <KpiTile
        label={t.unjudged}
        value={h.unjudged.toLocaleString()}
        spark={someCount(h.spark.unjudged)}
        description={t.unjudgedHelp}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Pass rate                                                                  */
/* -------------------------------------------------------------------------- */
