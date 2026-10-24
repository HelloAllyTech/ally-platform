import { AllyGuardFlag, AllyPairedWeek, AllyRate, AllyWeek } from "@types";

import { CONTEXT, PALETTE } from "./chartScales";
import { ChartDatum } from "./engagementChart";

import type { ColorScale } from "./chartScales";

/**
 * Pure transforms for the Analytics page's Ally tab (AAQ-240 to AAQ-251). Kept free of React so what
 * each chart plots, and what it withholds, is unit-testable without a DOM.
 *
 * Two rules run through all of it. A rate over fewer learners than the server's minimum group size
 * arrives with `rate: null` and is plotted as a gap, never as zero: a zero would read as "nobody did
 * it" when the truth is "too few to say". And the Monday of an ISO week is the x value as the server
 * sends it, so weeks line up across charts.
 */

/** A percentage point from a 0-1 rate; null stays null. */
export const toPercent = (rate: number | null | undefined): number | null =>
  rate === null || rate === undefined ? null : Number((rate * 100).toFixed(1));

/** One series of a rate per week, as percentages. A withheld rate is a null point. */
export const rateSeries = (
  weeks: readonly AllyWeek[],
  pick: (week: AllyWeek) => AllyRate,
  group: string,
): ChartDatum[] =>
  weeks.map(week => ({ group, key: week.week, value: toPercent(pick(week).rate) }));

/** One series of a plain figure per week (items per day, a score, a count per 100). */
export const valueSeries = (
  weeks: readonly AllyWeek[],
  pick: (week: AllyWeek) => number | null,
  group: string,
): ChartDatum[] => weeks.map(week => ({ group, key: week.week, value: pick(week) }));

/** True when any week's rate was withheld, so the chart can say gaps are withheld rates, not zeros. */
export const hasWithheld = (
  weeks: readonly AllyWeek[],
  picks: readonly ((week: AllyWeek) => AllyRate)[],
): boolean =>
  // The server also marks an empty week suppressed; only a rate with something
  // behind it was withheld.
  weeks.some(week =>
    picks.some(pick => {
      const rate = pick(week);
      return rate.suppressed && (rate.of > 0 || rate.learners > 0);
    }),
  );

/** Whether a series has anything to draw: at least one point that is not a gap. */
export const hasPoints = (series: readonly ChartDatum[]): boolean =>
  series.some(point => point.value !== null);

/** The weeks the guard flagged: engagement up while learning stayed flat or fell, or learning fell. */
export const FLAGGED: readonly AllyGuardFlag[] = ["engagement_up_learning_flat", "learning_fell"];

export const flaggedWeeks = (weeks: readonly AllyPairedWeek[]): AllyPairedWeek[] =>
  weeks.filter(week => FLAGGED.includes(week.guard));

/**
 * The paired chart's two panels share one timeline. Engagement is items per learning day and the
 * share of rated replies rated up; learning is quiz first-attempt pass. Percentages are on a 0-100
 * axis, items on their own, which is why they are separate panels rather than one dual-axis chart:
 * two axes would let the eye pair lines that were never meant to move together.
 */
export const pairedEngagementSeries = (
  weeks: readonly AllyPairedWeek[],
  labels: { items: string; thumbs: string },
): { items: ChartDatum[]; thumbs: ChartDatum[] } => ({
  items: weeks.map(week => ({
    group: labels.items,
    key: week.week,
    value: week.itemsPerLearningDay,
  })),
  thumbs: weeks.map(week => ({
    group: labels.thumbs,
    key: week.week,
    value: toPercent(week.thumbsUpShare),
  })),
});

export const pairedLearningSeries = (
  weeks: readonly AllyPairedWeek[],
  label: string,
): ChartDatum[] =>
  weeks.map(week => ({
    group: label,
    key: week.week,
    value: toPercent(week.quizFirstAttemptPass),
  }));

/** A percent for a table or tooltip: "62%", "—" for none. */
export const formatPercentValue = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `${Math.round(value)}%`;

/** A decimal figure for a table or tooltip, one place by default. */
export const formatFigure = (value: number | null | undefined, places = 1): string =>
  value === null || value === undefined ? "—" : value.toFixed(places);

/** A single accent for a one-series chart; a reference line is grey, never a second subject colour. */
export const single = (label: string): ColorScale => ({ [label]: PALETTE.blue });

export const pair = (subject: string, reference: string): ColorScale => ({
  [subject]: PALETTE.blue,
  [reference]: CONTEXT.line,
});

export const twoSeries = (first: string, second: string): ColorScale => ({
  [first]: PALETTE.blue,
  [second]: PALETTE.teal,
});

/** The ISO week as the axis shows it: its Monday, as the server sends it. */
export const weekLabel = (week: string): string => week;
