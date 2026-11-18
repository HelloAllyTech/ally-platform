import React from "react";

import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { DebriefRate } from "@types";

import { pctNum } from "./metricsData";

export const pct = (r: DebriefRate | null | undefined) =>
  r?.value == null ? en.debriefs.metrics.none : pctNum(r.value);

export const fixed = (x: number | null | undefined, d = 1) =>
  x == null ? en.debriefs.metrics.none : x.toFixed(d);

/** A trend of counts that never left zero says nothing: no sparkline. */
export const someCount = (xs: number[]) => (xs.some(x => x > 0) ? xs : undefined);

export const TILE_GRID = "grid grid-cols-2 gap-4 md:grid-cols-4";

export const SectionHeading: React.FC<{ title: string; help?: string }> = ({ title, help }) => (
  <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
    {title}
    {help && <InfoTip label={help} ariaLabel={`About ${title}`} />}
  </h3>
);

/** Two-line value words: the main number, then a smaller second reading. */
export const Words: React.FC<{ main: React.ReactNode; sub?: string }> = ({ main, sub }) => (
  <span className="flex flex-col">
    <span>{main}</span>
    {sub && <span className="text-typography-500">{sub}</span>}
  </span>
);
