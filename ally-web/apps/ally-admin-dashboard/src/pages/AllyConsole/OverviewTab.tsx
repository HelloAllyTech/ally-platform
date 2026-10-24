import React, { useState } from "react";

import {
  Button,
  ContentSwitcher,
  SkeletonPlaceholder,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tile,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideAlertCountsQuery, useGetAllyGuideOverviewQuery } from "@api";
import {
  formatCount,
  formatMs,
  formatPercent,
  formatUsd,
  releaseVersionLabel,
} from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, EmptyPanel } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { AllyGuideOverview } from "@types";
import { formatDate } from "@utils";

import { CanaryMonitor } from "./CanaryMonitor";

const WINDOWS = [7, 30] as const;

const TILE_GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6";

interface StatTileProps {
  label: string;
  help: string;
  value: string;
  detail?: string;
  testId: string;
  children?: React.ReactNode;
}

const StatTile: React.FC<StatTileProps> = ({ label, help, value, detail, testId, children }) => (
  <Tile className="flex flex-col gap-1" data-testid={testId}>
    <div className="flex items-center gap-1 text-xs tracking-wide text-typography-700">
      <span>{label}</span>
      <InfoTip label={help} ariaLabel={`About ${label}`} />
    </div>
    <div className="text-3xl font-normal text-typography-900">{value}</div>
    {detail && <div className="text-sm text-typography-700">{detail}</div>}
    {children}
  </Tile>
);

/**
 * Open alerts, from the counts endpoint (open and total, whatever their age). It has its own request:
 * a failed read says so in the tile and leaves the rest of the Overview alone.
 */
const AlertsTile: React.FC<{ onOpenAlerts: () => void }> = ({ onOpenAlerts }) => {
  const strings = en.allyConsole.overview.alertsTile;
  const { data, isLoading, isError } = useGetAllyGuideAlertCountsQuery();

  return (
    <StatTile
      testId="tile-alerts"
      label={strings.label}
      help={strings.help}
      value={isLoading ? "…" : isError || !data ? "—" : formatCount(data.open)}
      detail={
        isError
          ? strings.failed
          : isLoading || !data
            ? undefined
            : data.open === 0
              ? strings.none
              : strings.ofTotal(data.total)
      }
    >
      <Button kind="ghost" size="sm" className="mt-1 self-start !px-0" onClick={onOpenAlerts}>
        {strings.review}
      </Button>
    </StatTile>
  );
};

const OverviewSkeleton: React.FC = () => (
  <div role="status" aria-live="polite" data-testid="ally-overview-loading">
    <span className="sr-only">{en.allyConsole.states.loading}</span>
    <div className={TILE_GRID}>
      {[0, 1, 2, 3, 4, 5].map(index => (
        <SkeletonPlaceholder key={index} style={{ width: "100%", height: "120px" }} />
      ))}
    </div>
  </div>
);

const OverviewBody: React.FC<{
  data: AllyGuideOverview;
  onOpenReleases: () => void;
  onOpenAlerts: () => void;
}> = ({ data, onOpenReleases, onOpenAlerts }) => {
  const strings = en.allyConsole.overview;
  const { turns, cache, cost, release, safety, canary } = data;
  const noTraffic = turns.total === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className={TILE_GRID}>
        <StatTile
          testId="tile-turns"
          label={strings.tiles.turns}
          help={strings.tiles.turnsHelp}
          value={formatCount(turns.total)}
          detail={strings.tiles.turnsDetail(data.threads)}
        />
        <StatTile
          testId="tile-success"
          label={strings.tiles.success}
          help={strings.tiles.successHelp}
          value={formatPercent(turns.successRate)}
          detail={strings.tiles.successDetail(turns.failed, turns.interrupted)}
        />
        <StatTile
          testId="tile-cache"
          label={strings.tiles.cache}
          help={strings.tiles.cacheHelp}
          value={formatPercent(cache.ratio)}
          detail={strings.tiles.cacheDetail(
            formatCount(cache.readTokens),
            formatCount(cache.uncachedInputTokens),
          )}
        />
        <StatTile
          testId="tile-cost"
          label={strings.tiles.cost}
          help={strings.tiles.costHelp}
          value={formatUsd(cost.totalUsd)}
          detail={
            cost.perThreadUsd === null
              ? undefined
              : strings.tiles.costDetail(formatUsd(cost.perThreadUsd))
          }
        />
        <StatTile
          testId="tile-release"
          label={strings.tiles.release}
          help={strings.tiles.releaseHelp}
          value={release ? releaseVersionLabel(release.version) : strings.tiles.releaseNone}
          detail={
            release
              ? release.promotedAt
                ? strings.tiles.releaseDetail(formatDate(release.promotedAt))
                : undefined
              : strings.tiles.releaseNoneDetail
          }
        >
          {canary && (
            <div className="text-sm text-typography-800" data-testid="tile-release-canary">
              {strings.tiles.canaryDetail(releaseVersionLabel(canary.version), canary.percent)}
            </div>
          )}
          <Button kind="ghost" size="sm" className="mt-1 self-start !px-0" onClick={onOpenReleases}>
            {strings.tiles.openReleases}
          </Button>
        </StatTile>
        <AlertsTile onOpenAlerts={onOpenAlerts} />
      </div>

      <CanaryMonitor canary={canary} live={release} arms={data.arms} />

      {noTraffic ? (
        <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2" aria-labelledby="ally-ttft-heading">
            <div className="mb-2 flex items-center gap-1">
              <h3 id="ally-ttft-heading" className="text-xl font-normal text-typography-900">
                {strings.ttft.title}
              </h3>
              <InfoTip label={strings.ttft.help} ariaLabel="About time to first token" />
            </div>
            {data.timeToFirstTokenMs.length === 0 ? (
              <p className="text-sm text-typography-700" data-testid="ally-ttft-empty">
                {strings.ttft.empty}
              </p>
            ) : (
              <Table className="w-full border-collapse text-left" data-testid="ally-ttft-table">
                <TableHead>
                  <TableRow className="border-b border-border-light text-sm text-typography-700">
                    <TableHeader className="py-3 pr-4 font-medium">
                      {strings.ttft.channel}
                    </TableHeader>
                    <TableHeader className="py-3 pr-4 font-medium">
                      {strings.ttft.turns}
                    </TableHeader>
                    <TableHeader className="py-3 pr-4 font-medium">
                      {strings.ttft.median}
                    </TableHeader>
                    <TableHeader className="py-3 pr-4 font-medium">{strings.ttft.p95}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.timeToFirstTokenMs.map(row => (
                    <TableRow
                      key={row.channel}
                      className="border-b border-border-light text-sm text-typography-900"
                      data-testid={`ttft-row-${row.channel}`}
                    >
                      <TableCell className="py-3 pr-4">
                        {en.allyConsole.channels[row.channel] ?? row.channel}
                      </TableCell>
                      <TableCell className="py-3 pr-4 tabular-nums">
                        {formatCount(row.turns)}
                      </TableCell>
                      <TableCell className="py-3 pr-4 tabular-nums">{formatMs(row.p50)}</TableCell>
                      <TableCell className="py-3 pr-4 tabular-nums">{formatMs(row.p95)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section aria-labelledby="ally-safety-heading">
            <h3 id="ally-safety-heading" className="text-xl font-normal text-typography-900">
              {strings.safety.title}
            </h3>
            <p className="mb-2 text-xs text-typography-700">{strings.safety.help}</p>
            <dl
              className="divide-y divide-border-light border-y border-border-light"
              data-testid="ally-safety"
            >
              {[
                ["crises", strings.safety.crises, strings.safety.crisesHelp, safety.crises],
                [
                  "crisisReplies",
                  strings.safety.crisisReplies,
                  strings.safety.crisisRepliesHelp,
                  safety.crisisReplies,
                ],
                [
                  "careEntries",
                  strings.safety.careEntries,
                  strings.safety.careEntriesHelp,
                  safety.careEntries,
                ],
                ["refusals", strings.safety.refusals, strings.safety.refusalsHelp, safety.refusals],
                ["restarts", strings.safety.restarts, strings.safety.restartsHelp, safety.restarts],
              ].map(([key, label, help, count]) => (
                <div key={String(key)} className="flex items-center justify-between py-2">
                  <dt className="flex items-center gap-1 text-sm text-typography-800">
                    {label as string}
                    <InfoTip label={help as string} ariaLabel={`About ${label as string}`} />
                  </dt>
                  <dd
                    className="text-lg tabular-nums text-typography-900"
                    data-testid={`safety-${key as string}`}
                  >
                    {formatCount(count as number)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </div>
  );
};

interface OverviewTabProps {
  /** Jumps to the Releases tab, from the live-release tile. */
  onOpenReleases: () => void;
  /** Jumps to the Alerts tab, from the open-alerts tile. */
  onOpenAlerts: () => void;
}

/**
 * Live health for Ally over the last 7 or 30 days: turns and success, time to first token by
 * channel, cache hit ratio, cost, the safety counts, which release is live, how many alerts are
 * open, and the canary beside the live release when one is running. Counts only, never what a
 * learner said (that is the Conversations tab, behind its own permission).
 */
export const OverviewTab: React.FC<OverviewTabProps> = ({ onOpenReleases, onOpenAlerts }) => {
  const strings = en.allyConsole.overview;
  const [days, setDays] = useState<number>(7);
  // `currentData`, not `data`: `data` keeps the PREVIOUS window's numbers while the new one loads,
  // which would put 7-day figures under a "30 days" label.
  const { currentData: data, isError, error, refetch } = useGetAllyGuideOverviewQuery({ days });

  return (
    <div className="flex flex-col gap-4" data-testid="ally-overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-typography-700">{strings.windowSummary(days)}</p>
        <ContentSwitcher
          size="md"
          selectedIndex={WINDOWS.indexOf(days as (typeof WINDOWS)[number])}
          onChange={(event: { name?: string | number }) => setDays(Number(event.name))}
          className="max-w-xs"
          aria-label={strings.windowLabel}
        >
          <Switch name={7} text={strings.last7} />
          <Switch name={30} text={strings.last30} />
        </ContentSwitcher>
      </div>

      {data ? (
        <OverviewBody data={data} onOpenReleases={onOpenReleases} onOpenAlerts={onOpenAlerts} />
      ) : isError ? (
        <ErrorPanel what="the overview" error={error} onRetry={() => void refetch()} />
      ) : (
        <OverviewSkeleton />
      )}
    </div>
  );
};
