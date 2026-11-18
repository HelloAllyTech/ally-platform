import React from "react";

import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { DebriefExperienceRates, DebriefMetricsView, DebriefRate } from "@types";

import { BulletRows, NumbersTable } from "./metricsCharts";
import { Target, isThin, pctNum, sumRates } from "./metricsData";
import { rateBullet } from "./MetricsGuardrailsCard";
import { pct } from "./metricsShared";
import { ChartCard } from "../../Analytics/chartKit";
import { CONTEXT, stableScale } from "../../Analytics/chartScales";
import { languageLabel } from "../consoleLabels";

/** A rate with nothing counted (a server from before the pulse). */
export const NO_RATE: DebriefRate = { n: 0, of: 0, value: null };

export const BREAKDOWN_KEYS: Array<keyof DebriefExperienceRates> = [
  "openedWithin24h",
  "readThrough",
  "practiseClickThrough",
  "reflectionAnswered",
  "abandonedBeforeReady",
];

export const ExperienceSection: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
  const s = en.debriefs.metrics;
  const series = view.series;
  const last = series[series.length - 1];
  const window = (pick: (e: DebriefExperienceRates) => DebriefRate) =>
    sumRates(series.map(w => pick(w.experience)));
  const defs: Array<{
    key: string;
    label: string;
    pick: (e: DebriefExperienceRates) => DebriefRate;
    target?: Target;
    targetLabel?: string;
  }> = [
    {
      key: "opened",
      label: s.experience.openedWithin24h,
      pick: e => e.openedWithin24h,
      target: { atLeast: 0.85 },
      targetLabel: "≥ 85%",
    },
    {
      key: "read",
      label: s.experience.readThrough,
      pick: e => e.readThrough,
      target: { atLeast: 0.7 },
      targetLabel: "≥ 70%",
    },
    {
      key: "practise",
      label: s.experience.practiseClickThrough,
      pick: e => e.practiseClickThrough,
      target: { atLeast: 0.25 },
      targetLabel: "≥ 25%",
    },
    {
      key: "reflection",
      label: s.experience.reflectionAnswered,
      pick: e => e.reflectionAnswered,
      target: { atLeast: 0.15 },
      targetLabel: "≥ 15%",
    },
    {
      key: "abandoned",
      label: s.experience.abandonedBeforeReady,
      pick: e => e.abandonedBeforeReady,
      target: { atMost: 0.1 },
      targetLabel: "≤ 10%",
    },
    {
      key: "flags",
      label: s.experience.flagsWithinSla(view.flagReviewSlaHours),
      pick: e => e.flagsWithinSla,
      target: { atLeast: 0.95 },
      targetLabel: "≥ 95%",
    },
    { key: "listened", label: s.experience.listened, pick: e => e.listened },
    { key: "replied", label: s.experience.replied, pick: e => e.replied },
    // PRD §9: the post-launch pulse, asked on 1 in 10 debriefs for 8 weeks.
    {
      key: "pulseKnewNext",
      label: s.experience.pulseKnewNext,
      pick: e => e.pulseKnewNext ?? NO_RATE,
    },
    { key: "pulseFair", label: s.experience.pulseFair, pick: e => e.pulseFair ?? NO_RATE },
    {
      key: "pulseFairMoment",
      label: s.experience.pulseFairImportantMoment,
      pick: e => e.pulseFairImportantMoment ?? NO_RATE,
      target: { atLeast: 0.7 },
      targetLabel: "≥ 70%",
    },
  ];
  const rows = defs.map(d =>
    rateBullet(d.key, d.label, window(d.pick), {
      target: d.target,
      targetLabel: d.targetLabel,
      latest: last ? d.pick(last.experience) : null,
      max: 1,
    }),
  );
  return (
    <section className="flex flex-col gap-4">
      <ChartCard
        title={s.experience.heading}
        titleHelp={
          <InfoTip label={s.experience.help} ariaLabel={`About ${s.experience.heading}`} />
        }
        caption={s.sections.experienceCaption}
      >
        <BulletRows rows={rows} testId="metrics-experience" />
      </ChartCard>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ExperienceStrips
          title={s.sections.experienceByGroup(
            s.experience.byLanguage.replace(/^By /, "").toLowerCase(),
          )}
          rows={view.byLanguage}
          label={languageLabel}
          testId="metrics-by-language"
        />
        <ExperienceStrips
          title={s.sections.experienceByGroup(
            s.experience.byDevice.replace(/^By /, "").toLowerCase(),
          )}
          rows={view.byPlatform}
          testId="metrics-by-device"
        />
      </div>
    </section>
  );
};

/**
 * One row per experience measure on a 0–100% axis, one dot per group (language
 * or device) in that group's fixed colour, so groups can be compared measure by
 * measure. Thin groups are hollow.
 */
export const ExperienceStrips: React.FC<{
  title: string;
  testId: string;
  rows: DebriefMetricsView["byLanguage"];
  /** How a group is named (a language code becomes its name: no raw codes). */
  label?: (key: string) => string;
}> = ({ title, testId, rows, label = key => key }) => {
  const s = en.debriefs.metrics;
  if (!rows.length) return null;
  const scale = stableScale(rows.map(r => r.key));
  return (
    <ChartCard title={title} caption={s.sections.experienceByGroupCaption}>
      <div data-testid={testId}>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-typography-700">
          {rows.map(r => (
            <span key={r.key} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: scale[r.key] }}
              />
              {label(r.key)} <span className="text-typography-500">({r.debriefs})</span>
            </span>
          ))}
        </div>
        <div className="mb-1 grid grid-cols-1 gap-1 text-xs text-typography-500 sm:grid-cols-[minmax(9rem,14rem)_1fr] sm:gap-3">
          <span className="hidden sm:block" />
          <span className="flex justify-between tabular-nums">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </span>
        </div>
        {BREAKDOWN_KEYS.map(k => (
          <div
            key={k}
            className="grid grid-cols-1 items-center gap-1 border-t border-gray-100 py-1.5 sm:grid-cols-[minmax(9rem,14rem)_1fr] sm:gap-3"
          >
            <span className="text-xs text-typography-900">{s.experience[k] as string}</span>
            <span className="relative h-7">
              <span
                className="absolute inset-x-0 top-1/2 h-px"
                style={{ background: CONTEXT.faint }}
                aria-hidden
              />
              {rows.map((r, i) => {
                const rate = r.experience[k];
                if (rate.value == null) return null;
                const thin = isThin(rate);
                return (
                  <span
                    key={r.key}
                    title={`${label(r.key)}: ${pctNum(rate.value)} (${s.count(rate.n, rate.of)})${thin ? ` · ${s.states.thin}` : ""}`}
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                    style={{
                      // Each group on its own lane, so equal values never hide each other.
                      top: `${((i + 1) / (rows.length + 1)) * 100}%`,
                      left: `${rate.value * 100}%`,
                      background: thin ? "var(--cds-layer-01, white)" : scale[r.key],
                      borderColor: thin ? scale[r.key] : "var(--cds-layer-01, white)",
                    }}
                  />
                );
              })}
            </span>
          </div>
        ))}
        <NumbersTable
          head={["", ...BREAKDOWN_KEYS.map(k => s.experience[k] as string)]}
          rows={rows.map(r => [
            label(r.key),
            ...BREAKDOWN_KEYS.map(
              k => `${pct(r.experience[k])} (${s.count(r.experience[k].n, r.experience[k].of)})`,
            ),
          ])}
        />
      </div>
    </ChartCard>
  );
};

/* -------------------------------------------------------------------------- */
/* Uptake lift                                                                */
/* -------------------------------------------------------------------------- */
