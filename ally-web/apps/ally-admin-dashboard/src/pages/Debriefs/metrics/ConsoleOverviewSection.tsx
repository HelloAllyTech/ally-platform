import React from "react";

import { useGetDebriefOverviewQuery, useGetDebriefTenantsQuery } from "@api";
import { formatPercent, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";

import { ChartCard, KpiTile, PALETTE } from "../../Analytics/chartKit";
import { score } from "../consoleTable";

/** Projected month-end spend at the month's daily rate so far. */
export const burnRate = (
  spent: number | null | undefined,
  now: Date = new Date(),
): { perDay: number; monthEnd: number } | null => {
  if (spent == null) return null;
  const day = now.getDate();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const perDay = spent / Math.max(1, day);
  return { perDay, monthEnd: perDay * days };
};

/** One pool's balance as a bar: spent against its size. */
const Pool: React.FC<{ label: string; spent: number | null; of: number; testId: string }> = ({
  label,
  spent,
  of,
  testId,
}) => {
  const s = en.debriefs.analytics.cost;
  const share = spent != null && of > 0 ? Math.min(1, spent / of) : 0;
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-typography-700">
          {s.poolLine(
            formatUsd(spent),
            formatUsd(of),
            formatUsd(spent == null ? null : Math.max(0, of - spent)),
          )}
        </span>
      </div>
      <span className="relative h-2 bg-neutral-100" aria-hidden>
        <span
          className="absolute inset-y-0 left-0"
          style={{
            width: `${share * 100}%`,
            background: share >= 0.8 ? PALETTE.orange : PALETTE.blue,
          }}
        />
      </span>
    </div>
  );
};

/**
 * Analytics › Debriefs, the operator numbers (moved from the console's Runs tab and its cost
 * views, 2026-11-12): the six tiles, and spend — per organisation, the two pools, the burn rate.
 * Across all organisations over the last week; the filters above don't narrow these.
 */
export const ConsoleOverviewSection: React.FC = () => {
  const s = en.debriefs.runs.kpis;
  const a = en.debriefs.analytics;
  const overview = useGetDebriefOverviewQuery();
  const tenants = useGetDebriefTenantsQuery();
  const o = overview.data;
  const tile = {
    loading: overview.isLoading,
    error: overview.isError,
    onRetry: () => void overview.refetch(),
  };
  const burn = burnRate(o?.budget.monthSpentUsd);
  const spend = [...(tenants.data ?? [])]
    .filter(t => (t.monthSpentUsd ?? 0) > 0 || t.live)
    .sort((x, y) => (y.monthSpentUsd ?? 0) - (x.monthSpentUsd ?? 0));
  const maxSpend = Math.max(...spend.map(t => t.monthSpentUsd ?? 0), 0.0001);

  return (
    <section className="flex flex-col gap-4" data-testid="debrief-console-overview">
      <div>
        <h3 className="text-xl font-normal text-typography-900">{a.overviewHeading}</h3>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">
          {a.overviewHelp(o?.windowDays ?? 7)}
        </p>
      </div>
      <div
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
        data-testid="console-tiles"
      >
        <KpiTile
          label={s.runs}
          description={s.runsHelp}
          value={String(o?.runs.total ?? "—")}
          {...tile}
        />
        <KpiTile
          label={s.judge}
          description={`${s.judgeHelp} ${s.today(score(o?.judge.todayMean))}`}
          value={score(o?.judge.mean)}
          {...tile}
        />
        <KpiTile
          label={s.pass}
          description={s.passHelp}
          value={formatPercent(o?.judge.passRate)}
          {...tile}
        />
        <KpiTile
          label={s.person}
          description={s.personHelp}
          value={String(o?.runs.needsPerson ?? "—")}
          {...tile}
        />
        <KpiTile
          label={s.cost}
          description={`${s.costHelp} ${s.ceiling(formatUsd(o?.budget.runCeilingUsd))}`}
          value={o ? `${formatUsd(o.costUsd.p50)} / ${formatUsd(o.costUsd.p90)}` : "—"}
          {...tile}
        />
        <KpiTile
          label={s.month}
          description={`${s.monthHelp} ${s.cap(formatUsd(o?.budget.monthlyCapUsd))}`}
          value={formatUsd(o?.budget.monthSpentUsd)}
          {...tile}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="debrief-cost-panel">
        <ChartCard
          title={a.cost.perOrg}
          caption={a.cost.perOrgCaption}
          loading={tenants.isLoading}
          error={tenants.isError}
          onRetry={() => void tenants.refetch()}
        >
          {spend.length === 0 ? (
            <p className="text-sm text-typography-700">{a.cost.noSpend}</p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="spend-per-org">
              {spend.map(t => (
                <li
                  key={t.id}
                  className="grid grid-cols-[minmax(6rem,12rem)_1fr_5rem] items-center gap-2 text-xs"
                >
                  <span className="break-words text-typography-900">{t.name}</span>
                  <span className="relative h-2" aria-hidden>
                    <span
                      className="absolute inset-y-0 left-0 rounded"
                      style={{
                        width: `${((t.monthSpentUsd ?? 0) / maxSpend) * 100}%`,
                        background: PALETTE.blue,
                      }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-typography-700">
                    {formatUsd(t.monthSpentUsd ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
        <ChartCard
          title={a.cost.pools}
          caption={a.cost.poolsCaption}
          loading={overview.isLoading}
          error={overview.isError}
          onRetry={() => void overview.refetch()}
        >
          {o && (
            <div className="flex flex-col gap-4">
              <Pool
                label={a.cost.debriefPool}
                spent={o.budget.monthSpentUsd}
                of={o.budget.monthlyCapUsd}
                testId="pool-debriefs"
              />
              <Pool
                label={a.cost.learningPool}
                spent={o.budget.learningSpentUsd}
                of={o.budget.learningBudgetUsd}
                testId="pool-learning"
              />
              <p className="text-sm text-typography-900" data-testid="burn-rate">
                {burn
                  ? a.cost.burn(
                      formatUsd(burn.perDay),
                      formatUsd(burn.monthEnd),
                      formatUsd(o.budget.monthlyCapUsd),
                    )
                  : a.cost.noBurn}
              </p>
            </div>
          )}
        </ChartCard>
      </div>
    </section>
  );
};
