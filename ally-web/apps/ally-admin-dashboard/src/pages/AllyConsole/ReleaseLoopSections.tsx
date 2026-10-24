import React, { useEffect, useState } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideReleaseTrailQuery,
  useGetAllyGuideShadowReportQuery,
  useGetAllyGuideShadowReportsQuery,
  useStartAllyGuideShadowMutation,
} from "@api";
import {
  flattenToRows,
  formatPercent,
  formatUsd,
  releaseVersionLabel,
} from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { RootState } from "@store";
import { AllyGuideRelease, AllyGuideShadowReport } from "@types";
import { formatDateTime, getErrorMessage } from "@utils";

import { humanise, summariseDetail } from "./loopFormat";

const SHADOW_POLL_MS = 5000;
const SHADOW_TONES: Record<string, PillTone> = {
  running: "info",
  passed: "success",
  failed: "danger",
  inconclusive: "warning",
  error: "danger",
};

const Heading: React.FC<{ id: string; text: string; help?: string }> = ({ id, text, help }) => (
  <div className="flex items-center gap-1">
    <h3 id={id} className="text-xl font-normal text-typography-900">
      {text}
    </h3>
    {help && <InfoTip label={help} ariaLabel={`About ${text}`} />}
  </div>
);

/**
 * A release's whole trail, oldest first: created, gate, shadow, canary, decision, then live or
 * reverted, with the learning loop's own steps in the same list and, for a curator release, what the
 * curator changed. It reads from the release's own endpoint, so a failed read here never hides the
 * release above it.
 */
export const ReleaseTrailSection: React.FC<{ releaseId: string }> = ({ releaseId }) => {
  const strings = en.allyConsole.loop;
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideReleaseTrailQuery(releaseId);

  const who = (id: number | null, kind: string, name: string | null) =>
    id === null || id === undefined
      ? (en.allyConsole.curator.actors[kind] ?? kind)
      : currentUserId !== undefined && currentUserId !== null && Number(currentUserId) === id
        ? en.allyConsole.delegation.you
        : (name ?? en.allyConsole.delegation.user(id));

  const changeSet = data?.release.changeSet;
  const changeRows = changeSet ? flattenToRows(changeSet) : [];

  return (
    <section className="flex flex-col gap-2" data-testid="release-trail">
      <Heading id={`trail-${releaseId}`} text={strings.trailHeading} help={strings.trailHelp} />
      {isLoading ? (
        <LoadingBlock lines={3} />
      ) : isError || !data ? (
        <ErrorPanel what={strings.trailLoadFailed} error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          {changeRows.length > 0 && (
            <div data-testid="release-change-set">
              <h4 className="flex items-center gap-1 text-sm font-semibold text-typography-900">
                {strings.changeSet}
                <InfoTip label={strings.changeSetHelp} ariaLabel="About the change set" />
              </h4>
              <ul className="text-xs text-typography-800">
                {changeRows.slice(0, 12).map(row => (
                  <li key={row.key} className="break-words">
                    <span className="font-mono">{row.key}</span>: {row.value}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.trail.length === 0 ? (
            <p className="text-sm text-typography-700" data-testid="trail-empty">
              {strings.trailEmpty}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full border-collapse text-left" data-testid="trail-table">
                <TableHead>
                  <TableRow className="border-b border-border-light text-xs text-typography-700">
                    <TableHeader className="py-2 pr-4 font-medium">
                      {strings.trailColumns.when}
                    </TableHeader>
                    <TableHeader className="py-2 pr-4 font-medium">
                      {strings.trailColumns.what}
                    </TableHeader>
                    <TableHeader className="py-2 pr-4 font-medium">
                      {strings.trailColumns.who}
                    </TableHeader>
                    <TableHeader className="py-2 pr-4 font-medium">
                      {strings.trailColumns.detail}
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.trail.map((row, index) => (
                    <TableRow
                      key={`${row.at}-${row.action}-${index}`}
                      className="border-b border-border-light align-top text-sm text-typography-900"
                      data-testid="trail-row"
                    >
                      <TableCell className="whitespace-nowrap py-2 pr-4">
                        {formatDateTime(row.at)}
                      </TableCell>
                      <TableCell className="py-2 pr-4">
                        {(row.source === "learning"
                          ? en.allyConsole.curator.auditActions[row.action]
                          : undefined) ?? humanise(row.action)}
                        <span className="block text-xs text-typography-700">
                          {strings.sources[row.source]}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 pr-4">
                        {who(row.actorUserId, row.actorKind, row.actorName)}
                      </TableCell>
                      <TableCell className="max-w-xs break-words py-2 pr-4 text-xs text-typography-700">
                        {summariseDetail(row.detail)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </section>
  );
};

const ShadowReportDetail: React.FC<{ reportId: string }> = ({ reportId }) => {
  const strings = en.allyConsole.loop.report;
  const report = useGetAllyGuideShadowReportQuery(reportId);

  if (report.isLoading) return <LoadingBlock lines={4} />;
  if (report.isError || !report.data) {
    return (
      <ErrorPanel
        what={strings.loadFailed}
        error={report.error}
        onRetry={() => void report.refetch()}
      />
    );
  }
  const { summary } = report.data;
  const sides = [
    ["ga", summary.ga],
    ["candidate", summary.candidate],
  ] as const;

  return (
    <div className="flex flex-col gap-3 border border-border-light p-3" data-testid="shadow-report">
      <h4 className="text-base font-semibold text-typography-900">{strings.heading}</h4>
      {summary.error ? (
        <p className="text-sm text-destructive-600">{strings.failedRun(summary.error)}</p>
      ) : (
        <>
          {(summary.reasons ?? []).length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-typography-900">
                {strings.reasonsHeading}
              </h5>
              <ul
                className="list-disc pl-6 text-sm text-typography-800"
                data-testid="shadow-reasons"
              >
                {(summary.reasons ?? []).map(reason => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="shadow-sides">
              <TableHead>
                <TableRow className="border-b border-border-light text-xs text-typography-700">
                  <TableHeader className="py-2 pr-4 font-medium">&nbsp;</TableHeader>
                  {sides.map(([key]) => (
                    <TableHeader key={key} className="py-2 pr-4 font-medium">
                      {strings.sides[key]}
                    </TableHeader>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow
                  className="border-b border-border-light text-sm"
                  data-testid="shadow-pass-rate"
                >
                  <TableCell className="py-2 pr-4">{strings.measures.passRate}</TableCell>
                  {sides.map(([key, side]) => (
                    <TableCell key={key} className="py-2 pr-4 tabular-nums">
                      {formatPercent(side?.passRate)}
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow
                  className="border-b border-border-light text-sm"
                  data-testid="shadow-safety"
                >
                  <TableCell className="py-2 pr-4">{strings.measures.safety}</TableCell>
                  {sides.map(([key, side]) => (
                    <TableCell key={key} className="py-2 pr-4 tabular-nums">
                      {side?.safetyFailures ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow className="border-b border-border-light text-sm">
                  <TableCell className="py-2 pr-4">{strings.measures.words}</TableCell>
                  {sides.map(([key, side]) => (
                    <TableCell key={key} className="py-2 pr-4 tabular-nums">
                      {side?.meanWords === null || side?.meanWords === undefined
                        ? "—"
                        : Math.round(side.meanWords)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-typography-800" data-testid="shadow-new-safety">
            {strings.newSafety(summary.newSafetyFailures ?? 0)}
          </p>
          <p className="text-sm text-typography-800" data-testid="shadow-crisis">
            {strings.crisis(summary.crisisDisagreements ?? 0)}
          </p>
          {(summary.errors ?? 0) > 0 && (
            <p className="text-sm text-typography-700">{strings.errors(summary.errors ?? 0)}</p>
          )}
          {Object.keys(summary.byCheck ?? {}).length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-typography-900">
                {strings.byCheckHeading}
              </h5>
              <Table className="w-full border-collapse text-left" data-testid="shadow-by-check">
                <TableHead>
                  <TableRow className="border-b border-border-light text-xs text-typography-700">
                    <TableHeader className="py-1 pr-4 font-medium">
                      {strings.byCheckColumns.check}
                    </TableHeader>
                    <TableHeader className="py-1 pr-4 font-medium">
                      {strings.byCheckColumns.ga}
                    </TableHeader>
                    <TableHeader className="py-1 pr-4 font-medium">
                      {strings.byCheckColumns.candidate}
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(summary.byCheck ?? {}).map(([check, [ga, candidate]]) => (
                    <TableRow key={check} className="border-b border-border-light text-sm">
                      <TableCell className="py-1 pr-4 font-mono text-xs">{check}</TableCell>
                      <TableCell className="py-1 pr-4 tabular-nums">{ga}</TableCell>
                      <TableCell className="py-1 pr-4 tabular-nums">{candidate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Shadowing a release: replay recent real turns on it in dry run and compare with what the live
 * release said. Starting one needs the edit grant and is not offered for the live release (a shadow
 * compares a candidate with it). The list refreshes by itself while one runs; a report opens to the
 * candidate beside live, the new safety failures and the checks that failed: ids and counts only.
 */
export const ShadowSection: React.FC<{ release: AllyGuideRelease; canEdit: boolean }> = ({
  release,
  canEdit,
}) => {
  const strings = en.allyConsole.loop;
  const [pollMs, setPollMs] = useState(0);
  const reports = useGetAllyGuideShadowReportsQuery(
    { releaseId: release.id },
    { pollingInterval: pollMs },
  );
  const [start, { isLoading: isStarting }] = useStartAllyGuideShadowMutation();
  const [runOpen, setRunOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const running = (reports.data ?? []).some(report => report.status === "running");
  useEffect(() => {
    setPollMs(running ? SHADOW_POLL_MS : 0);
  }, [running]);

  const handleStart = async () => {
    try {
      await start(release.id).unwrap();
      toast.success(strings.shadowRunDialog.started);
      setRunOpen(false);
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.shadowRunDialog.failed));
    }
  };

  const version = releaseVersionLabel(release.version);
  const isLive = release.status === "ga";

  return (
    <section className="flex flex-col gap-2" data-testid="release-shadow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading
          id={`shadow-${release.id}`}
          text={strings.shadowHeading}
          help={strings.shadowHelp}
        />
        {canEdit && !isLive && (
          <Button kind="tertiary" size="sm" onClick={() => setRunOpen(true)}>
            {strings.shadowRun}
          </Button>
        )}
      </div>
      {isLive && <p className="text-xs text-typography-700">{strings.shadowNeedsGa}</p>}

      {reports.isLoading ? (
        <LoadingBlock lines={2} />
      ) : reports.isError || !reports.data ? (
        <ErrorPanel
          what={strings.shadowLoadFailed}
          error={reports.error}
          onRetry={() => void reports.refetch()}
        />
      ) : reports.data.length === 0 ? (
        <p className="text-sm text-typography-700" data-testid="shadow-empty">
          {strings.shadowEmpty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="shadow-reports">
            <TableHead>
              <TableRow className="border-b border-border-light text-xs text-typography-700">
                {Object.values(strings.shadowColumns).map(label => (
                  <TableHeader key={label} className="py-2 pr-4 font-medium">
                    {label}
                  </TableHeader>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {reports.data.map((report: AllyGuideShadowReport) => {
                const when = formatDateTime(report.createdAt);
                return (
                  <TableRow
                    key={report.id}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="shadow-report-row"
                  >
                    <TableCell className="py-2 pr-4">
                      <Pill tone={SHADOW_TONES[report.status] ?? "neutral"}>
                        {strings.shadowStatuses[report.status] ?? report.status}
                      </Pill>
                    </TableCell>
                    <TableCell className="py-2 pr-4 tabular-nums">{report.turnCount}</TableCell>
                    <TableCell className="whitespace-nowrap py-2 pr-4">
                      <button
                        type="button"
                        className="text-primary-500 hover:underline"
                        aria-label={strings.shadowOpen(when)}
                        onClick={() => setOpenId(openId === report.id ? null : report.id)}
                      >
                        {when}
                      </button>
                    </TableCell>
                    <TableCell className="py-2 pr-4 tabular-nums">
                      {formatUsd(report.costUsd)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {openId && <ShadowReportDetail key={openId} reportId={openId} />}

      <ConfirmDialog
        isOpen={runOpen}
        title={strings.shadowRunDialog.title(version)}
        cancelLabel={strings.shadowRunDialog.cancel}
        confirmLabel={
          isStarting ? strings.shadowRunDialog.working : strings.shadowRunDialog.confirm
        }
        isWorking={isStarting}
        onConfirm={() => void handleStart()}
        onClose={() => setRunOpen(false)}
      >
        <p>{strings.shadowRunDialog.body}</p>
      </ConfirmDialog>
    </section>
  );
};
