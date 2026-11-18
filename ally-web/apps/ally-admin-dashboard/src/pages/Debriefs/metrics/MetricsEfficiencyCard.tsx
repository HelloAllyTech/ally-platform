import React from "react";

import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { DebriefMetricsView } from "@types";

import { BulletRow, BulletRows } from "./metricsCharts";
import { sumRates, targetState } from "./metricsData";
import { rateBullet } from "./MetricsGuardrailsCard";
import { fixed } from "./metricsShared";
import { ChartCard } from "../../Analytics/chartKit";

export const EfficiencyCard: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
  const s = en.debriefs.metrics;
  const series = view.series;
  const e = series[series.length - 1]?.efficiency;
  const within = sumRates(series.map(w => w.efficiency.within10Min));
  const saved = e?.savedUsdMean ?? null;
  const steps = e?.stepsP50 ?? null;
  const rows: BulletRow[] = [
    {
      key: "saved",
      label: s.efficiency.saved,
      value: saved,
      max: Math.max(0.5, Math.ceil((saved ?? 0) * 1.25 * 10) / 10),
      words: saved == null ? s.none : formatUsd(saved),
    },
    {
      key: "revisions",
      label: s.efficiency.revisions,
      targetLabel: "≤ 1",
      value: e?.revisionRoundsP50 ?? null,
      targets: [1],
      max: Math.max(3, e?.revisionRoundsP50 ?? 0),
      words: fixed(e?.revisionRoundsP50, 0),
      state: targetState(e?.revisionRoundsP50 ?? null, { atMost: 1 }),
    },
    {
      key: "steps",
      label: s.efficiency.steps,
      value: steps,
      max: Math.max(10, steps ?? 0),
      words: fixed(steps, 0),
    },
    rateBullet("within10", s.efficiency.within10, within, {
      target: { atLeast: 0.99 },
      targetLabel: "≥ 99%",
      latest: e?.within10Min,
      max: 1,
    }),
  ];
  return (
    <ChartCard title={s.efficiency.heading} caption={s.sections.efficiencyCaption}>
      <BulletRows rows={rows} testId="metrics-efficiency" />
    </ChartCard>
  );
};
