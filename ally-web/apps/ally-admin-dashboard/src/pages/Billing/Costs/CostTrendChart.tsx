import "@carbon/charts/styles.css";
import React, { useMemo } from "react";

import type { CostTrendPoint } from "@api";
import { StackedBarChart } from "@components/charts";

import { PALETTE, stackedBarOpts } from "../../Analytics/chartKit";
import { BILLING } from "../copy";
import { formatUsd } from "../money";

const T = BILLING.costs.trend;

/** Cost per day, AI calls and WhatsApp fees stacked (the app's Carbon charts, themed). */
export const CostTrendChart: React.FC<{ points: CostTrendPoint[] }> = ({ points }) => {
  const data = useMemo(
    () =>
      points.flatMap(p => [
        { group: T.ai, key: p.day.slice(5), value: p.ai },
        { group: T.whatsapp, key: p.day.slice(5), value: p.whatsapp },
      ]),
    [points],
  );
  const options = useMemo(() => {
    const base = stackedBarOpts({
      leftTitle: T.axis,
      colorScale: { [T.ai]: PALETTE.blue, [T.whatsapp]: PALETTE.teal },
      height: "260px",
    });
    return {
      ...base,
      axes: {
        ...base.axes,
        left: {
          ...base.axes.left,
          ticks: { formatter: (tick: number | Date) => formatUsd(Number(tick), 2) },
        },
      },
    };
  }, []);

  const total = points.reduce((sum, p) => sum + p.ai + p.whatsapp, 0);
  if (!points.length || total === 0) {
    return <p className="text-sm text-typography-500 py-6">{T.empty}</p>;
  }
  return (
    <div className="min-w-0 overflow-hidden" data-testid="billing-cost-trend">
      <StackedBarChart data={data} options={options as never} />
    </div>
  );
};
