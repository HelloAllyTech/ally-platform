import React, { useMemo, useState } from "react";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import { useGetDebriefGuidanceMetricsQuery } from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { LineChart } from "@components/charts";
import { en } from "@constants";
import { useColorMode } from "@hooks/useColorMode";
import { GuidanceMetrics, GuidanceMetricsMode } from "@types";

import { NumbersTable } from "./metricsCharts";
import { ChartCard, KpiTile, lineOpts } from "../../Analytics/chartKit";

const DAY_CHOICES = [7, 30, 90];
const MODES: GuidanceMetricsMode[] = ["all", "live", "shadow"];

/** Categorical slots 1 and 2 of the dataviz reference palette, validated per mode. */
const SERIES = {
  light: { blue: "#2a78d6", orange: "#eb6834" },
  dark: { blue: "#3987e5", orange: "#d95926" },
};

const num = (n: number | null | undefined, digits = 0) =>
  typeof n === "number" ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";
const ms = (n: number | null | undefined) => (typeof n === "number" ? `${num(n)} ms` : "—");

/**
 * Analytics › Debriefs › Guidance: how the fixed guidance lookup and the guidance agent are
 * doing. Read from `GET guidance-metrics?days=&mode=`; read-only. The PM agent reads the same
 * numbers from the backend.
 */
export const GuidanceSection: React.FC = () => {
  const s = en.debriefs.guidanceMetrics;
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<GuidanceMetricsMode>("all");
  const q = useGetDebriefGuidanceMetricsQuery({ days, mode });
  const d = q.data;

  return (
    <section className="flex flex-col gap-6" data-testid="guidance-metrics">
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-xl font-normal text-typography-900">{s.heading}</h3>
          <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-48">
            <Dropdown
              id="guidance-days"
              titleText={s.window}
              label={s.days(days)}
              size="sm"
              items={DAY_CHOICES}
              itemToString={(x: number | null) => (x ? s.days(x) : "")}
              selectedItem={days}
              onChange={({ selectedItem }: { selectedItem: number | null }) =>
                setDays(selectedItem ?? 30)
              }
            />
          </div>
          <div className="flex items-end gap-1">
            <div className="w-40">
              <Dropdown
                id="guidance-mode"
                titleText={s.mode}
                label={s.modes[mode]}
                size="sm"
                items={MODES}
                itemToString={(x: GuidanceMetricsMode | null) => (x ? s.modes[x] : "")}
                selectedItem={mode}
                onChange={({ selectedItem }: { selectedItem: GuidanceMetricsMode | null }) =>
                  setMode(selectedItem ?? "all")
                }
              />
            </div>
            <InfoTip label={s.modeHelp} ariaLabel={s.mode} />
          </div>
        </div>
      </div>

      {q.isError && !d ? (
        <p className="text-sm text-typography-700" data-testid="guidance-error">
          {s.loadFailed}{" "}
          <button
            type="button"
            className="text-blue-700 underline"
            onClick={() => void q.refetch()}
          >
            {s.retry}
          </button>
        </p>
      ) : q.isLoading || !d ? (
        <p className="text-sm text-typography-500" data-testid="guidance-loading">
          …
        </p>
      ) : d.runs.total === 0 ? (
        <p className="text-sm text-typography-700" data-testid="guidance-empty">
          {s.empty}
        </p>
      ) : (
        <GuidanceBody d={d} />
      )}
    </section>
  );
};

const Heading: React.FC<{ title: string; help?: string }> = ({ title, help }) => (
  <h4 className="flex items-center gap-1 text-base font-normal text-typography-900">
    {title}
    {help && <InfoTip label={help} ariaLabel={title} />}
  </h4>
);

const GuidanceBody: React.FC<{ d: GuidanceMetrics }> = ({ d }) => {
  const s = en.debriefs.guidanceMetrics;
  const { isDark } = useColorMode();
  const colors = isDark ? SERIES.dark : SERIES.light;
  const share = d.planner.decided > 0 ? d.planner.chose / d.planner.decided : null;
  const maxFetched = Math.max(1, ...d.entries.map(e => e.fetched));
  const daily = useMemo(() => d.daily, [d.daily]);
  const agentDays = daily.map(r => ({ group: s.trend.withAgent, key: r.date, value: r.withAgent }));
  const timeDays = daily.flatMap(r => [
    ...(typeof r.avgLookupMs === "number"
      ? [{ group: s.trend.lookup, key: r.date, value: r.avgLookupMs }]
      : []),
    ...(typeof r.avgAgentMs === "number"
      ? [{ group: s.trend.agent, key: r.date, value: r.avgAgentMs }]
      : []),
  ]);
  const cmp = d.compare;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="guidance-tiles">
        <KpiTile
          label={s.tiles.runs}
          description={`${s.tiles.runsHelp} ${s.tiles.runsSplit(d.runs.withAgent, d.runs.withLookup)}`}
          value={num(d.runs.total)}
        />
        <KpiTile
          label={s.tiles.agentShare}
          description={s.tiles.agentShareHelp}
          value={share == null ? "—" : `${Math.round(share * 100)}%`}
          n={d.planner.decided}
          nUnit={s.tiles.decidedUnit}
        />
        <KpiTile
          label={s.tiles.lookup}
          description={s.tiles.lookupHelp}
          value={d.latency.lookup.n ? ms(d.latency.lookup.p50Ms) : "—"}
          n={d.latency.lookup.n}
          nUnit={s.tiles.runsUnit}
        />
        <KpiTile
          label={s.tiles.agent}
          description={s.tiles.agentHelp}
          value={d.latency.agent.n ? ms(d.latency.agent.p50Ms) : "—"}
          n={d.latency.agent.n}
          nUnit={s.tiles.runsUnit}
        />
      </div>

      <div className="flex flex-col gap-2" data-testid="guidance-tools">
        <Heading title={s.tools.heading} help={s.tools.help} />
        {d.tools.length === 0 ? (
          <p className="text-sm text-typography-700">{s.tools.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="text-xs text-typography-700">
                <tr>
                  <th className="w-1/4 py-1 pr-2 font-normal">{s.tools.step}</th>
                  <th className="w-1/4 py-1 pr-2 font-normal">{s.tools.tool}</th>
                  <th className="py-1 pr-2 text-right font-normal">{s.tools.calls}</th>
                  <th className="py-1 pr-2 text-right font-normal">{s.tools.ok}</th>
                  <th className="py-1 pr-2 text-right font-normal">{s.tools.avgMs}</th>
                  <th className="py-1 pr-2 text-right font-normal">{s.tools.p90Ms}</th>
                  <th className="py-1 text-right font-normal">{s.tools.avgCodes}</th>
                </tr>
              </thead>
              <tbody>
                {d.tools.map(t => {
                  const tool = s.tools.names[t.tool] ?? t.tool;
                  return (
                    <tr key={`${t.step}-${t.tool}`} className="border-t border-gray-200">
                      <td className="truncate py-1 pr-2" title={t.step}>
                        {t.step}
                      </td>
                      <td className="truncate py-1 pr-2" title={t.tool}>
                        {tool} <span className="text-xs text-typography-500">{t.tool}</span>
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{num(t.calls)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{num(t.ok)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{ms(t.avgMs)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{ms(t.p90Ms)}</td>
                      <td className="py-1 text-right tabular-nums">{num(t.avgCodes, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2" data-testid="guidance-entries">
        <Heading title={s.entries.heading} help={s.entries.help} />
        {d.entries.length === 0 ? (
          <p className="text-sm text-typography-700">{s.entries.empty}</p>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(8rem,16rem)_1fr_4rem_5rem_4rem] items-center gap-x-3 text-xs text-typography-500">
              <span />
              <span>{s.entries.fetched}</span>
              <span className="text-right">{s.entries.fetched}</span>
              <span className="text-right">{s.entries.given}</span>
              <span className="text-right">{s.entries.runs}</span>
            </div>
            <ul className="flex flex-col">
              {d.entries.map(e => (
                <li
                  key={e.code}
                  className="grid grid-cols-[minmax(8rem,16rem)_1fr_4rem_5rem_4rem] items-center gap-x-3 border-t border-gray-100 py-1.5 text-sm"
                  data-testid={`guidance-entry-${e.code}`}
                >
                  <span
                    className="min-w-0 truncate text-typography-900"
                    title={`${e.title} (${e.code})`}
                  >
                    {e.title} <span className="text-xs text-typography-500">{e.code}</span>
                  </span>
                  <span
                    className="relative h-2"
                    role="img"
                    aria-label={s.entries.barLabel(e.title, e.fetched)}
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-r"
                      style={{
                        width: `${(e.fetched / maxFetched) * 100}%`,
                        background: colors.blue,
                      }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{num(e.fetched)}</span>
                  <span className="text-right tabular-nums">{num(e.given)}</span>
                  <span className="text-right tabular-nums">{num(e.runs)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3" data-testid="guidance-trend">
        <Heading title={s.trend.heading} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard
            title={s.trend.withAgent}
            titleHelp={<InfoTip label={s.trend.withAgentHelp} ariaLabel={s.trend.withAgent} />}
            empty={!daily.length}
            emptyText={s.trend.empty}
          >
            <LineChart
              data={agentDays}
              options={lineOpts({
                leftTitle: s.trend.countAxis,
                legend: false,
                colorScale: { [s.trend.withAgent]: colors.blue },
              })}
            />
          </ChartCard>
          <ChartCard
            title={s.trend.time}
            titleHelp={<InfoTip label={s.trend.timeHelp} ariaLabel={s.trend.time} />}
            empty={!timeDays.length}
            emptyText={s.trend.empty}
          >
            <LineChart
              data={timeDays}
              options={lineOpts({
                leftTitle: s.trend.ms,
                colorScale: { [s.trend.lookup]: colors.blue, [s.trend.agent]: colors.orange },
              })}
            />
          </ChartCard>
        </div>
        <NumbersTable
          testId="guidance-trend-numbers"
          summary={s.numbers}
          head={[s.trend.date, s.trend.runs, s.trend.withAgent, s.trend.lookup, s.trend.agent]}
          rows={daily.map(r => [
            r.date,
            num(r.runs),
            num(r.withAgent),
            ms(r.avgLookupMs),
            ms(r.avgAgentMs),
          ])}
        />
      </div>

      <div className="flex flex-col gap-2" data-testid="guidance-compare">
        <Heading title={s.compare.heading} help={s.compare.help} />
        <table className="w-full max-w-2xl table-fixed text-left text-sm">
          <thead className="text-xs text-typography-700">
            <tr>
              <th className="py-1 pr-2 font-normal">{s.compare.group}</th>
              <th className="py-1 pr-2 text-right font-normal">{s.compare.n}</th>
              <th className="py-1 pr-2 text-right font-normal">{s.compare.judge}</th>
              <th className="py-1 text-right font-normal">{s.compare.cost}</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["with", s.compare.withAgent, cmp.withAgent],
                ["without", s.compare.withoutAgent, cmp.withoutAgent],
              ] as const
            ).map(([key, label, c]) => (
              <tr
                key={key}
                className="border-t border-gray-200"
                data-testid={`guidance-compare-${key}`}
              >
                <td className="truncate py-1 pr-2" title={label}>
                  {label}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{num(c.n)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {c.avgJudge == null ? s.compare.none : num(c.avgJudge, 1)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {c.avgCostUsd == null ? s.compare.none : formatUsd(c.avgCostUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="max-w-3xl text-sm text-typography-700">{s.compare.note}</p>
      </div>

      <div className="flex flex-col gap-2" data-testid="guidance-skips">
        <Heading title={s.skips.heading} help={s.skips.help} />
        {d.planner.skipReasons.length === 0 ? (
          <p className="text-sm text-typography-700">{s.skips.empty}</p>
        ) : (
          <ul className="flex max-w-2xl flex-col">
            {d.planner.skipReasons.slice(0, 5).map(r => (
              <li key={r.why} className="flex gap-3 border-t border-gray-100 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate text-typography-900" title={r.why}>
                  {r.why}
                </span>
                <span className="shrink-0 tabular-nums text-typography-700">
                  {s.skips.times(r.count)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
