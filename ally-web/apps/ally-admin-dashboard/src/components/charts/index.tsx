/**
 * The admin console's Carbon charts, themed to the top-bar light/dark switch.
 *
 * Import charts from here, not from `@carbon/charts-react` directly: Carbon charts paint their
 * own colour tokens on the chart holder from `options.theme` (default "white"), so a chart that
 * isn't told the mode stays a white panel with dark axis labels in dark mode. Each export here is
 * the Carbon component of the same name with `theme` filled in from useColorMode, and nothing
 * else changed. A chart that sets its own `options.theme` keeps it.
 */
import React, { useMemo } from "react";

import * as Carbon from "@carbon/charts-react";

import { useColorMode } from "@hooks/useColorMode";

import type { ChartTheme } from "@carbon/charts";

type ChartName =
  | "AreaChart"
  | "ComboChart"
  | "DonutChart"
  | "GroupedBarChart"
  | "LineChart"
  | "ScatterChart"
  | "SimpleBarChart"
  | "StackedBarChart";

/** The Carbon component's own props, spelled out so the exports below have a nameable type. */
type ChartComponent<N extends ChartName> = React.FC<React.ComponentProps<(typeof Carbon)[N]>>;

function themed<N extends ChartName>(name: N): ChartComponent<N> {
  type Props = React.ComponentProps<(typeof Carbon)[N]>;
  function ThemedChart(props: Props) {
    const { isDark } = useColorMode();
    const { options } = props as { options?: { theme?: ChartTheme } };
    const themedOptions = useMemo(
      () => ({ ...options, theme: options?.theme ?? ((isDark ? "g100" : "white") as ChartTheme) }),
      [options, isDark],
    );
    // Looked up at render, not import: test files mock `@carbon/charts-react` with only the
    // charts they render, and reading a missing export from such a mock throws.
    const Chart = Carbon[name] as unknown as React.ComponentType<Props>;
    return <Chart {...props} options={themedOptions} />;
  }
  ThemedChart.displayName = `Themed${name}`;
  return ThemedChart;
}

export const AreaChart: ChartComponent<"AreaChart"> = themed("AreaChart");
export const ComboChart: ChartComponent<"ComboChart"> = themed("ComboChart");
export const DonutChart: ChartComponent<"DonutChart"> = themed("DonutChart");
export const GroupedBarChart: ChartComponent<"GroupedBarChart"> = themed("GroupedBarChart");
export const LineChart: ChartComponent<"LineChart"> = themed("LineChart");
export const ScatterChart: ChartComponent<"ScatterChart"> = themed("ScatterChart");
export const SimpleBarChart: ChartComponent<"SimpleBarChart"> = themed("SimpleBarChart");
export const StackedBarChart: ChartComponent<"StackedBarChart"> = themed("StackedBarChart");
