import React, { useState } from "react";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideReleasesQuery, useGetAllyGuideRollbackTargetQuery } from "@api";
import { releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideRelease } from "@types";
import { formatDate, formatDateTime } from "@utils";

import { ReleaseAuditTrail } from "./ReleaseAuditTrail";
import {
  PromoteReleaseDialog,
  RollbackReleaseDialog,
  StartCanaryDialog,
  StopCanaryDialog,
} from "./ReleaseDialogs";
import { ReleaseDrawer } from "./ReleaseDrawer";
import { ReleaseStatusPill } from "./ReleaseStatusPill";
import { StartEvalRunDialog } from "./StartEvalRunDialog";

interface ReleasesTabProps {
  /** Jumps to the Overview, where a canary is compared with the live release. */
  onOpenOverview?: () => void;
}

/**
 * Ally's releases, newest first, with promote, rollback and canary for admins who may edit, and the
 * history of every change beneath.
 *
 * A release is the whole behaviour bundle (prompts, model routing, policy, capabilities) frozen
 * under a content hash, and exactly one is live at a time. Reading is for everyone with the console;
 * promote, rollback and canary need the edit grant and are hidden, not greyed, since a disabled
 * button with no way to enable it only teaches people to ask why.
 */
export const ReleasesTab: React.FC<ReleasesTabProps> = ({ onOpenOverview }) => {
  const strings = en.allyConsole.releases;
  const { canEdit } = useAllyGuideAccess();
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideReleasesQuery();
  // Where a rollback would land: the server decides, and the dialog names it. While it loads the
  // button says so; if the lookup fails the button stays usable (in an incident, a failed second
  // request must not block the one action meant to be fast) and the dialog words it generally.
  const {
    data: rollbackTarget,
    isLoading: targetLoading,
    isError: targetFailed,
  } = useGetAllyGuideRollbackTargetQuery();

  const [openId, setOpenId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<AllyGuideRelease | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [startingCanary, setStartingCanary] = useState<AllyGuideRelease | null>(null);
  const [stoppingCanary, setStoppingCanary] = useState<AllyGuideRelease | null>(null);
  const [evalRelease, setEvalRelease] = useState<AllyGuideRelease | null>(null);

  if (isLoading) return <LoadingBlock lines={6} />;
  if (isError || !data) {
    return <ErrorPanel what="releases" error={error} onRetry={() => void refetch()} />;
  }
  if (data.length === 0) {
    return <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />;
  }

  const live = data.find(release => release.status === "ga") ?? null;
  const canary = data.find(release => release.status === "canary") ?? null;
  const canRollBack = live !== null && (targetFailed || Boolean(rollbackTarget));
  const opened = data.find(release => release.id === openId);

  return (
    <div className="flex flex-col gap-4" data-testid="ally-releases">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-typography-800" data-testid="releases-live-summary">
          {live
            ? strings.liveSummary(
                releaseVersionLabel(live.version),
                live.promotedAt ? formatDate(live.promotedAt) : null,
              )
            : strings.noneLive}
        </p>
        {canEdit &&
          (canRollBack ? (
            <Button kind="danger--tertiary" size="md" onClick={() => setRollbackOpen(true)}>
              {strings.rollback}
            </Button>
          ) : (
            <Tooltip
              label={targetLoading ? strings.rollbackChecking : strings.rollbackNeedsTwo}
              align="top"
            >
              {/* Wrapped in a span: a disabled button receives no hover, so it could not say why. */}
              <span>
                <Button kind="danger--tertiary" size="md" disabled>
                  {strings.rollback}
                </Button>
              </span>
            </Tooltip>
          ))}
      </div>

      {canary && (
        <div
          role="status"
          className="flex flex-col gap-3 border border-warning-200 bg-warning-50 p-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="releases-canary-banner"
        >
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold text-typography-900">
              {strings.canaryBanner.title(
                releaseVersionLabel(canary.version),
                canary.rolloutPercent ?? null,
              )}
            </p>
            <p className="text-sm text-typography-800">
              {strings.canaryBanner.body(live ? releaseVersionLabel(live.version) : null)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenOverview && (
              <Button kind="tertiary" size="md" onClick={onOpenOverview}>
                {strings.canaryBanner.compare}
              </Button>
            )}
            {canEdit && (
              <>
                <Button kind="primary" size="md" onClick={() => setPromoting(canary)}>
                  {strings.canaryBanner.promote}
                </Button>
                <Button kind="danger--tertiary" size="md" onClick={() => setStoppingCanary(canary)}>
                  {strings.canaryBanner.stop}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table className="w-full border-collapse text-left" data-testid="ally-releases-table">
          <TableHead>
            <TableRow className="border-b border-border-light text-sm text-typography-700">
              <TableHeader className="py-3 pr-4 font-medium">{strings.columns.version}</TableHeader>
              <TableHeader className="py-3 pr-4 font-medium">
                <span className="inline-flex items-center gap-1">
                  {strings.columns.status}
                  <InfoTip label={strings.statusHelp} ariaLabel="About release statuses" />
                </span>
              </TableHeader>
              <TableHeader className="py-3 pr-4 font-medium">{strings.columns.author}</TableHeader>
              <TableHeader className="py-3 pr-4 font-medium">{strings.columns.notes}</TableHeader>
              <TableHeader className="py-3 pr-4 font-medium">
                {strings.columns.promoted}
              </TableHeader>
              <TableHeader className="py-3 pr-4 font-medium">{strings.columns.created}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map(release => {
              const version = releaseVersionLabel(release.version);
              return (
                <TableRow
                  key={release.id}
                  onClick={() => setOpenId(release.id)}
                  className="cursor-pointer border-b border-border-light align-top text-sm text-typography-900 hover:bg-background-secondary"
                  data-testid="release-row"
                >
                  <TableCell className="py-3 pr-4">
                    <button
                      type="button"
                      className="font-medium text-primary-500 hover:underline"
                      aria-label={strings.open(version)}
                      onClick={event => {
                        event.stopPropagation();
                        setOpenId(release.id);
                      }}
                    >
                      {version}
                    </button>
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    <ReleaseStatusPill
                      status={release.status}
                      rolloutPercent={release.rolloutPercent}
                    />
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    {strings.authors[release.authorKind] ?? release.authorKind}
                  </TableCell>
                  <TableCell className="max-w-md py-3 pr-4">
                    <span className="line-clamp-2 break-words" title={release.notes ?? undefined}>
                      {release.notes ?? strings.noNotes}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-3 pr-4">
                    {release.promotedAt ? formatDateTime(release.promotedAt) : strings.notPromoted}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-3 pr-4">
                    {formatDateTime(release.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ReleaseAuditTrail />

      <ReleaseDrawer
        releaseId={openId}
        summary={opened}
        canEdit={canEdit}
        onPromote={release => {
          setOpenId(null);
          setPromoting(release);
        }}
        onStartCanary={release => {
          setOpenId(null);
          setStartingCanary(release);
        }}
        onStopCanary={release => {
          setOpenId(null);
          setStoppingCanary(release);
        }}
        onRunEvals={release => {
          setOpenId(null);
          setEvalRelease(release);
        }}
        onClose={() => setOpenId(null)}
      />
      <StartEvalRunDialog release={evalRelease} onClose={() => setEvalRelease(null)} />
      <PromoteReleaseDialog
        release={promoting}
        current={live}
        canary={canary}
        onClose={() => setPromoting(null)}
      />
      <RollbackReleaseDialog
        isOpen={rollbackOpen}
        current={live}
        target={rollbackTarget ?? null}
        onClose={() => setRollbackOpen(false)}
      />
      <StartCanaryDialog
        release={startingCanary}
        live={live}
        onClose={() => setStartingCanary(null)}
      />
      <StopCanaryDialog
        canary={stoppingCanary}
        live={live}
        onClose={() => setStoppingCanary(null)}
      />
    </div>
  );
};
