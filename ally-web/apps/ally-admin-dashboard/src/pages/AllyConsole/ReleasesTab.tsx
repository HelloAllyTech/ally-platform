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
import { useGetAllyGuideReleasesQuery } from "@api";
import { releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideRelease } from "@types";
import { formatDate, formatDateTime } from "@utils";

import { PromoteReleaseDialog, RollbackReleaseDialog } from "./ReleaseDialogs";
import { ReleaseDrawer } from "./ReleaseDrawer";
import { ReleaseStatusPill } from "./ReleaseStatusPill";

/**
 * Ally's releases, newest first, with one-click promote and rollback for admins who may edit.
 *
 * A release is the whole behaviour bundle (prompts, model routing, policy, capabilities) frozen
 * under a content hash, and exactly one is live at a time. Reading is for everyone with the console;
 * promote and rollback need the edit grant and are hidden, not greyed, without it, since a disabled
 * button with no way to enable it only teaches people to ask why.
 */
export const ReleasesTab: React.FC = () => {
  const strings = en.allyConsole.releases;
  const { canEdit } = useAllyGuideAccess();
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideReleasesQuery();

  const [openId, setOpenId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<AllyGuideRelease | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  if (isLoading) return <LoadingBlock lines={6} />;
  if (isError || !data) {
    return <ErrorPanel what="releases" error={error} onRetry={() => void refetch()} />;
  }
  if (data.length === 0) {
    return <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />;
  }

  const live = data.find(release => release.status === "ga") ?? null;
  // The server decides the real target (the release the last promotion replaced); this only stops
  // offering a rollback when there is plainly nothing to go back to.
  const canRollBack = live !== null && data.length > 1;
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
            <Tooltip label={strings.rollbackNeedsTwo} align="top">
              {/* Wrapped in a span: a disabled button receives no hover, so it could not say why. */}
              <span>
                <Button kind="danger--tertiary" size="md" disabled>
                  {strings.rollback}
                </Button>
              </span>
            </Tooltip>
          ))}
      </div>

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
                    <ReleaseStatusPill status={release.status} />
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

      <ReleaseDrawer
        releaseId={openId}
        summary={opened}
        canEdit={canEdit}
        onPromote={release => {
          setOpenId(null);
          setPromoting(release);
        }}
        onClose={() => setOpenId(null)}
      />
      <PromoteReleaseDialog release={promoting} current={live} onClose={() => setPromoting(null)} />
      <RollbackReleaseDialog
        isOpen={rollbackOpen}
        current={live}
        onClose={() => setRollbackOpen(false)}
      />
    </div>
  );
};
