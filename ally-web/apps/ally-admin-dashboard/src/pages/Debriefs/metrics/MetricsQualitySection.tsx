import React, { useMemo } from "react";

import { AreaChart } from "@components/charts";
import { en } from "@constants";
import {
  DebriefFilterOptions,
  DebriefMetricsView,
  DebriefPassBreakdownRow,
  DebriefPassGroup,
  DebriefPassRateSegment,
  DebriefRate,
} from "@types";

import { NumbersTable, RateDots, RateRow } from "./metricsCharts";
import { niceCeiling, rangeOf, rateBand, rateWithRange, sumRates } from "./metricsData";
import { SegmentBar } from "./MetricsFilterBar";
import { ChartCard, lineOpts, PALETTE } from "../../Analytics/chartKit";
import { languageLabel } from "../consoleLabels";
import { SectionHeading, fixed, pct } from "./metricsShared";

export const bandChartOpts = (title: string, color: string, domain: [number, number]) =>
  lineOpts({
    leftTitle: `${title} (%)`,
    colorScale: { [title]: color },
    domain,
    legend: false,
    extra: {
      bounds: { upperBoundMapsTo: "max", lowerBoundMapsTo: "min" },
      points: { enabled: true, radius: 4 },
      tooltip: {
        valueFormatter: (v: unknown) => (typeof v === "number" ? `${v}%` : "—"),
      },
    },
  });

/**
 * A breakdown group's name as people read it. Step-model groups arrive as "<step>: <model>", so the
 * step id becomes the step's name from the run view; lower-case groups ("risk cue") get a capital.
 */
export const groupLabel = (key: string): string => {
  const at = key.indexOf(": ");
  if (at > 0) {
    const step = key.slice(0, at);
    const name = en.debriefs.run.stepNames[step];
    if (name) return `${name}: ${key.slice(at + 2)}`;
  }
  return /^[a-z]/.test(key) && !/[-_]/.test(key) ? key.charAt(0).toUpperCase() + key.slice(1) : key;
};

export const groupRows = (
  list: DebriefPassBreakdownRow[],
  label: (key: string) => string = groupLabel,
): RateRow[] => {
  return list.map(r => ({
    key: r.key,
    label: label(r.key),
    rate: r.passRate,
    extra: en.debriefs.metrics.sections.groupExtra(pct(r.hardFailRate), fixed(r.judgeMean, 1)),
  }));
};

export const groupTable = (
  list: DebriefPassBreakdownRow[],
  label: (key: string) => string = groupLabel,
): string[][] =>
  list.map(r => [
    label(r.key),
    String(r.debriefs),
    rateWithRange(r.passRate),
    rateWithRange(r.hardFailRate),
    fixed(r.judgeMean, 2),
  ]);

/**
 * The pass rate (same definition as the test-set evals): by week as a line with
 * its 95% band, then every breakdown as dot-and-whisker rows.
 */
export const QualitySection: React.FC<{
  quality: DebriefMetricsView["quality"];
  options: DebriefFilterOptions | undefined;
  segment: DebriefPassRateSegment;
  onSegment: (s: DebriefPassRateSegment) => void;
}> = ({ quality, options, segment, onSegment }) => {
  const s = en.debriefs.metrics.quality;
  const sec = en.debriefs.metrics.sections;
  const c = s.cols;
  const weeks = useMemo(() => quality?.byWeek ?? [], [quality]);
  const hardBand = useMemo(
    () =>
      rateBand(
        c.hardFailRate,
        weeks.map(w => ({ week: w.week, rate: w.hardFailRate })),
      ),
    [weeks, c.hardFailRate],
  );
  if (!quality) return null;
  const hardMax =
    niceCeiling(weeks.map(w => rangeOf(w.hardFailRate).high ?? w.hardFailRate.value ?? 0)) * 100;
  const total = (pick: (g: DebriefPassGroup) => DebriefRate) => sumRates(weeks.map(pick));

  const languageRows: DebriefPassBreakdownRow[] = quality.byLanguage.map(l => ({
    ...l,
    key: l.language,
  }));
  const segmented = Object.values(segment).some(v => v !== undefined && v !== "");

  return (
    <section className="flex flex-col gap-4" data-testid="metrics-quality">
      <SectionHeading title={s.heading} help={s.help} />
      <SegmentBar options={options} segment={segment} onSegment={onSegment} />
      {weeks.length === 0 ? (
        <p className="text-sm text-typography-700" data-testid="metrics-quality-empty">
          {segmented ? s.segments.noMatch : s.empty}
        </p>
      ) : (
        <>
          <p className="sr-only" data-testid="metrics-quality-headline">
            {rateWithRange(total(g => g.passRate))}
          </p>
          <div className="grid grid-cols-1 gap-4">
            <ChartCard
              title={sec.hardFailByWeek}
              caption={sec.hardFailByWeekCaption}
              empty={!hardBand.some(p => p.value != null)}
              emptyText={s.empty}
            >
              <div data-testid="metrics-hard-fail-by-week">
                <AreaChart
                  data={hardBand}
                  options={bandChartOpts(c.hardFailRate, PALETTE.orange, [0, hardMax])}
                />
              </div>
            </ChartCard>
          </div>
          <NumbersTable
            testId="metrics-quality-weeks"
            head={[c.week, c.passRate, c.hardFailRate, c.judgeMean]}
            rows={weeks.map(w => [
              w.week,
              rateWithRange(w.passRate),
              rateWithRange(w.hardFailRate),
              fixed(w.judgeMean, 2),
            ])}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {languageRows.length > 0 && (
              <ChartCard title={s.byLanguage} caption={sec.breakdownsCaption}>
                <RateDots
                  rows={groupRows(languageRows, languageLabel)}
                  max={1}
                  testId="metrics-by-language-dots"
                />
                <NumbersTable
                  testId="metrics-quality-languages"
                  head={[c.language, c.debriefs, c.passRate, c.hardFailRate, c.judgeMean]}
                  rows={groupTable(languageRows, languageLabel)}
                />
              </ChartCard>
            )}
          </div>
          <LanguageProblems rows={quality.byLanguage} />
        </>
      )}
    </section>
  );
};

/** Top two fault kinds of a language, in plain words (kinds never wrap: two at most). */
export const topKinds = (byType: Record<string, number>, names: Record<string, string>): string =>
  Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, n]) => `${names[k] ?? k} ${n}`)
    .join(" · ");

export const LanguageProblems: React.FC<{
  rows: NonNullable<DebriefMetricsView["quality"]>["byLanguage"];
}> = ({ rows }) => {
  const s = en.debriefs.metrics.quality.languageProblems;
  const withCheck = rows.filter(r => r.languageProblem && r.languageProblem.checked > 0);
  if (withCheck.length === 0) return null;
  return (
    <div data-testid="metrics-language-problems">
      <ChartCard title={s.title} caption={s.caption}>
        <NumbersTable
          testId="metrics-language-problems-table"
          head={[
            en.debriefs.metrics.quality.cols.language,
            s.cols.checked,
            s.cols.withProblem,
            s.cols.kinds,
          ]}
          rows={withCheck.map(r => {
            const p = r.languageProblem!;
            return [
              languageLabel(r.language),
              String(p.checked),
              rateWithRange(p.withFinding),
              topKinds(p.byType, s.types) || s.none,
            ];
          })}
        />
      </ChartCard>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Guardrails, efficiency, experience: bullet charts against targets          */
/* -------------------------------------------------------------------------- */
