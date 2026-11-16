import React, { useMemo, useState } from "react";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import { useGetDebriefNightlyQuery } from "@api";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { LineChart } from "@components/charts";
import { en } from "@constants";
import { DebriefNightlyRow } from "@types";

import { ChartCard, lineOpts, PALETTE } from "../../Analytics/chartKit";

type Point = { group: string; key: string; value: number };

const sliceLabel = (slice: string) => {
  const s = en.debriefs.nightly;
  if (slice === "all") return s.all;
  const [kind, value] = slice.split(":");
  return kind === "language" ? s.language(value) : s.recipe(value);
};

/** One line per series, skipping days a series has no value. */
const series = (
  rows: DebriefNightlyRow[],
  pick: Array<[string, (r: DebriefNightlyRow) => number | null | undefined]>,
): Point[] =>
  rows.flatMap(r =>
    pick.flatMap(([group, f]) => {
      const v = f(r);
      return typeof v === "number" ? [{ group, key: r.day, value: v }] : [];
    }),
  );

/**
 * Analytics › Debriefs › Nightly check (v9 FR-49, release-2 plan P3): the
 * nightly job's measures by day, sliced by language or recipe, the alerts it
 * raised, and the weekly judge drift. Read from `GET metrics/nightly`.
 */
export const NightlyCheckSection: React.FC = () => {
  const s = en.debriefs.nightly;
  const q = useGetDebriefNightlyQuery({ days: 56 });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const slices = useMemo(
    () =>
      [
        "all",
        ...Array.from(new Set(rows.map(r => r.slice))).filter(
          x => x.startsWith("language:") || x.startsWith("recipe:"),
        ),
      ].sort((a, b) => (a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b))),
    [rows],
  );
  const [slice, setSlice] = useState("all");
  const day = rows.filter(r => r.slice === slice);
  const drift = rows.filter(r => r.slice === "judge_drift");
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const alerts = rows
    .filter(r => (r.slice === "all" || r.slice === "judge_drift") && r.day >= cutoff)
    .flatMap(r => r.alerts.map(a => ({ ...a, day: r.day })))
    .reverse();
  const latest = rows.filter(r => r.slice === "all").at(-1)?.metrics.dataQuality;
  const state = { loading: q.isLoading, error: q.isError, onRetry: () => void q.refetch() };
  const empty = !q.isLoading && !rows.length;
  const limit = drift.at(-1)?.metrics.max ?? 0.3;

  return (
    <section className="flex flex-col gap-6" data-testid="nightly-check">
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-xl font-normal text-typography-900">{s.heading}</h3>
          <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
        </div>
        {slices.length > 1 && (
          <div className="w-64">
            <Dropdown
              id="nightly-slice"
              titleText={s.slice}
              label={sliceLabel(slice)}
              size="sm"
              items={slices}
              itemToString={(x: string | null) => (x ? sliceLabel(x) : "")}
              selectedItem={slice}
              onChange={({ selectedItem }: { selectedItem: string | null }) =>
                setSlice(selectedItem ?? "all")
              }
            />
          </div>
        )}
      </div>
      {empty ? (
        <p className="text-sm text-typography-700" data-testid="nightly-empty">
          {s.empty}
        </p>
      ) : (
        <>
          <div data-testid="nightly-alerts" className="flex flex-col gap-2">
            <h4 className="text-base font-normal text-typography-900">{s.alertsHeading}</h4>
            {alerts.length === 0 ? (
              <p className="text-sm text-typography-700">{s.noAlerts}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {alerts.map((a, i) => (
                  <li
                    key={`${a.day}-${a.code}-${i}`}
                    className="flex gap-3 border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm"
                  >
                    <span className="shrink-0 tabular-nums text-typography-700">{a.day}</span>
                    <span className="min-w-0 text-typography-900">{a.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {latest && (
              <p className="text-sm text-typography-700" data-testid="nightly-data-quality">
                {s.dataQuality(
                  latest.runs,
                  latest.noLanguage,
                  latest.unjudged,
                  latest.stuck,
                  latest.failed,
                )}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard
              title={s.charts.words}
              titleHelp={<InfoTip label={s.charts.wordsHelp} ariaLabel={s.charts.words} />}
              {...state}
              empty={!day.length}
            >
              <LineChart
                data={series(day, [
                  [s.charts.p50, r => r.metrics.wordsP50],
                  [s.charts.p90, r => r.metrics.wordsP90],
                ])}
                options={lineOpts({
                  leftTitle: s.charts.words,
                  colorScale: { [s.charts.p50]: PALETTE.blue, [s.charts.p90]: PALETTE.teal },
                })}
              />
            </ChartCard>
            <ChartCard
              title={s.charts.sameness}
              titleHelp={<InfoTip label={s.charts.samenessHelp} ariaLabel={s.charts.sameness} />}
              {...state}
              empty={!day.some(r => typeof r.metrics.sameness === "number")}
            >
              <LineChart
                data={series(day, [[s.charts.sameness, r => r.metrics.sameness]])}
                options={lineOpts({
                  leftTitle: "0–1",
                  domain: [0, 1],
                  legend: false,
                  colorScale: { [s.charts.sameness]: PALETTE.purple },
                })}
              />
            </ChartCard>
            <ChartCard
              title={s.charts.specificity}
              titleHelp={
                <InfoTip label={s.charts.specificityHelp} ariaLabel={s.charts.specificity} />
              }
              {...state}
              empty={!day.some(r => typeof r.metrics.specificity === "number")}
            >
              <LineChart
                data={series(day, [[s.charts.specificity, r => r.metrics.specificity]])}
                options={lineOpts({
                  leftTitle: "0–10",
                  domain: [0, 10],
                  legend: false,
                  colorScale: { [s.charts.specificity]: PALETTE.blue },
                })}
              />
            </ChartCard>
            <ChartCard
              title={s.charts.gap}
              titleHelp={<InfoTip label={s.charts.gapHelp} ariaLabel={s.charts.gap} />}
              {...state}
              empty={!day.some(r => typeof r.metrics.evaluatorJudgeGap === "number")}
            >
              <LineChart
                data={series(day, [[s.charts.gap, r => r.metrics.evaluatorJudgeGap]])}
                options={lineOpts({
                  leftTitle: "points",
                  legend: false,
                  colorScale: { [s.charts.gap]: PALETTE.orange },
                })}
              />
            </ChartCard>
            <ChartCard
              title={s.charts.drift}
              titleHelp={<InfoTip label={s.charts.driftHelp} ariaLabel={s.charts.drift} />}
              {...state}
              empty={!drift.length}
            >
              <LineChart
                data={[
                  ...series(drift, [[s.charts.drift, r => r.metrics.drift]]),
                  ...drift.flatMap(r => [
                    { group: s.charts.limit, key: r.day, value: limit },
                    { group: `${s.charts.limit} `, key: r.day, value: -limit },
                  ]),
                ]}
                options={lineOpts({
                  leftTitle: "points",
                  legend: false,
                  colorScale: {
                    [s.charts.drift]: PALETTE.blue,
                    [s.charts.limit]: PALETTE.red,
                    [`${s.charts.limit} `]: PALETTE.red,
                  },
                })}
              />
            </ChartCard>
          </div>
        </>
      )}
    </section>
  );
};
