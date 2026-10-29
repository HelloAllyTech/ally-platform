import React, { useState } from "react";

import { Button, ContentSwitcher, Switch } from "@ally-ui-mono/ui-shared";
import { useGetDebriefOverviewQuery, useGetDebriefRunsQuery } from "@api";
import { formatPercent, formatUsd, shortId } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefRunStatus } from "@types";

import { ConsoleTable, formatWhen, score } from "./consoleTable";
import { RunPanel } from "./RunPanel";
import { KpiTile } from "../Analytics/chartKit";

const FILTERS = ["all", "needs_person", "below_bar", "published"] as const;
type Filter = (typeof FILTERS)[number];

/** Runs: the agent at a glance, then every run, newest first, each opening its timeline. */
export const RunsTab: React.FC = () => {
  const s = en.debriefs.runs;
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const overview = useGetDebriefOverviewQuery();
  const runs = useGetDebriefRunsQuery({
    status: filter === "all" ? "" : (filter as DebriefRunStatus),
  });
  const o = overview.data;
  const tile = {
    loading: overview.isLoading,
    error: overview.isError,
    onRetry: () => void overview.refetch(),
  };

  return (
    <div className="flex flex-col gap-8" data-testid="runs-tab">
      <div>
        <h2 className="text-xl font-normal text-typography-900">{s.heading}</h2>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
      </div>

      {o?.mode === "off" && <EmptyPanel title={s.offTitle} message={s.offMessage} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile
          label={s.kpis.runs}
          description={s.kpis.runsHelp}
          value={String(o?.runs.total ?? "—")}
          {...tile}
        />
        <KpiTile
          label={s.kpis.judge}
          description={`${s.kpis.judgeHelp} ${s.kpis.today(score(o?.judge.todayMean))}`}
          value={score(o?.judge.mean)}
          {...tile}
        />
        <KpiTile
          label={s.kpis.pass}
          description={s.kpis.passHelp}
          value={formatPercent(o?.judge.passRate)}
          {...tile}
        />
        <KpiTile
          label={s.kpis.person}
          description={s.kpis.personHelp}
          value={String(o?.runs.needsPerson ?? "—")}
          {...tile}
        />
        <KpiTile
          label={s.kpis.cost}
          description={`${s.kpis.costHelp} ${s.kpis.ceiling(formatUsd(o?.budget.runCeilingUsd))}`}
          value={o ? `${formatUsd(o.costUsd.p50)} / ${formatUsd(o.costUsd.p90)}` : "—"}
          {...tile}
        />
        <KpiTile
          label={s.kpis.month}
          description={`${s.kpis.monthHelp} ${s.kpis.cap(formatUsd(o?.budget.monthlyCapUsd))}`}
          value={formatUsd(o?.budget.monthSpentUsd)}
          {...tile}
        />
      </div>

      <section className="flex flex-col gap-4">
        <ContentSwitcher
          size="md"
          selectedIndex={FILTERS.indexOf(filter)}
          onChange={(event: { name?: string | number }) => setFilter(event.name as Filter)}
          className="max-w-xl"
          aria-label={s.filterLabel}
        >
          {FILTERS.map(name => (
            <Switch key={name} name={name} text={s.filters[name]} />
          ))}
        </ContentSwitcher>

        {runs.isError ? (
          <ErrorPanel what={s.loadFailed} error={runs.error} onRetry={() => void runs.refetch()} />
        ) : !runs.data ? (
          <LoadingBlock lines={5} />
        ) : runs.data.length === 0 ? (
          <EmptyPanel title={s.emptyTitle} message={s.emptyMessage} />
        ) : (
          <ConsoleTable
            testId="runs-table"
            headers={[
              s.columns.when,
              s.columns.session,
              s.columns.organisation,
              s.columns.mode,
              s.columns.status,
              s.columns.judge,
              s.columns.evaluator,
              s.columns.cost,
              s.columns.time,
              <span key="a" className="sr-only">
                {s.open}
              </span>,
            ]}
            rows={runs.data.map(r => ({
              key: r.id,
              testId: "run-row",
              cells: [
                formatWhen(r.createdAt),
                <span key="s" className="font-mono text-xs">
                  {shortId(r.scenarioSessionId)} · {r.language ?? "—"}
                </span>,
                r.tenantName ?? "—",
                en.debriefs.mode[r.mode],
                <span key="st" className="flex flex-wrap gap-1">
                  <Pill
                    tone={
                      r.status === "published"
                        ? "success"
                        : r.status === "needs_person" || r.status === "failed"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {en.debriefs.status[r.status]}
                  </Pill>
                  {r.hasRiskCue && <Pill tone="info">{s.riskCue}</Pill>}
                </span>,
                score(r.judgeOverall),
                score(r.evaluatorOverall),
                formatUsd(r.costUsd),
                r.seconds != null ? `${r.seconds}s` : "—",
                <Button
                  key="o"
                  kind="tertiary"
                  size="sm"
                  aria-label={s.openLabel(shortId(r.id))}
                  onClick={() => setOpenId(r.id)}
                >
                  {s.open}
                </Button>,
              ],
            }))}
          />
        )}
      </section>

      <RunPanel runId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
};
