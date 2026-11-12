import React from "react";

import { formatPercent, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { DebriefAnalyticsView } from "@types";

import { ChartCard, KpiTile, PALETTE } from "../../Analytics/chartKit";
import { score } from "../consoleTable";

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
 * From `GET analytics`, across every organisation; the filters above don't narrow these.
 */
export const ConsoleOverviewSection: React.FC<{
  view: DebriefAnalyticsView | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}> = ({ view, loading, error, onRetry }) => {
  const s = en.debriefs.runs.kpis;
  const a = en.debriefs.analytics;
  const tile = { loading, error, onRetry };
  const t = view?.tiles;
  const cost = view?.cost;
  const spend = [...(cost?.perOrg ?? [])]
    .filter(o => o.monthSpentUsd > 0 || o.live)
    .sort((x, y) => y.monthSpentUsd - x.monthSpentUsd);
  const maxSpend = Math.max(...spend.map(o => o.monthSpentUsd), 0.0001);

  return (
    <section className="flex flex-col gap-4" data-testid="debrief-console-overview">
      <div>
        <h3 className="text-xl font-normal text-typography-900">{a.overviewHeading}</h3>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">
          {a.overviewHelp(view?.windowDays ?? 7)}
        </p>
      </div>
      <div
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
        data-testid="console-tiles"
      >
        <KpiTile label={s.runs} description={s.runsHelp} value={String(t?.runs ?? "—")} {...tile} />
        <KpiTile label={s.judge} description={s.judgeHelp} value={score(t?.judgeMean)} {...tile} />
        <KpiTile
          label={s.pass}
          description={s.passHelp}
          value={formatPercent(t?.meetsTheBar)}
          {...tile}
        />
        <KpiTile
          label={s.person}
          description={s.personHelp}
          value={String(t?.needsAPerson ?? "—")}
          {...tile}
        />
        <KpiTile
          label={s.cost}
          description={`${s.costHelp} ${s.ceiling(formatUsd(cost?.pool.runCeilingUsd))}`}
          value={t ? `${formatUsd(t.costP50Usd)} / ${formatUsd(t.costP90Usd)}` : "—"}
          {...tile}
        />
        <KpiTile
          label={s.month}
          description={`${s.monthHelp} ${s.cap(formatUsd(cost?.pool.monthlyCapUsd))}`}
          value={formatUsd(t?.spentThisMonthUsd)}
          {...tile}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="debrief-cost-panel">
        <ChartCard
          title={a.cost.perOrg}
          caption={a.cost.perOrgCaption}
          loading={loading}
          error={error}
          onRetry={onRetry}
        >
          {spend.length === 0 ? (
            <p className="text-sm text-typography-700">{a.cost.noSpend}</p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="spend-per-org">
              {spend.map(o => (
                <li
                  key={o.tenantId}
                  className="grid grid-cols-[minmax(6rem,12rem)_1fr_5rem] items-center gap-2 text-xs"
                >
                  <span className="break-words text-typography-900">{o.tenantName}</span>
                  <span className="relative h-2" aria-hidden>
                    <span
                      className="absolute inset-y-0 left-0 rounded"
                      style={{
                        width: `${(o.monthSpentUsd / maxSpend) * 100}%`,
                        background: PALETTE.blue,
                      }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-typography-700">
                    {formatUsd(o.monthSpentUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
        <ChartCard
          title={a.cost.pools}
          caption={a.cost.poolsCaption}
          loading={loading}
          error={error}
          onRetry={onRetry}
        >
          {cost && (
            <div className="flex flex-col gap-4">
              <Pool
                label={a.cost.debriefPool}
                spent={cost.pool.spentUsd}
                of={cost.pool.monthlyCapUsd}
                testId="pool-debriefs"
              />
              <Pool
                label={a.cost.learningPool}
                spent={cost.learning.spentUsd}
                of={cost.learning.budgetUsd}
                testId="pool-learning"
              />
              <p className="text-sm text-typography-900" data-testid="burn-rate">
                {cost.burnRate.perDayUsd != null && cost.burnRate.projectedMonthUsd != null
                  ? a.cost.burn(
                      formatUsd(cost.burnRate.perDayUsd),
                      formatUsd(cost.burnRate.projectedMonthUsd),
                      formatUsd(cost.pool.monthlyCapUsd),
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
