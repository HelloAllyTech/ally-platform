import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  SidePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideReleasesQuery,
  useGetAllyGuideSyntheticRunQuery,
  useGetAllyGuideSyntheticRunsQuery,
  useRunAllyGuideSyntheticMutation,
} from "@api";
import {
  formatPercent,
  formatUsd,
  releaseVersionLabel,
} from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideSyntheticRun } from "@types";
import { getErrorMessage } from "@utils";

const POLL_MS = 5000;
const STATUS_TONES: Record<string, PillTone> = {
  running: "info",
  completed: "success",
  error: "danger",
};

const RunDetail: React.FC<{ runId: string }> = ({ runId }) => {
  const strings = en.allyConsole.synthetic.detail;
  const run = useGetAllyGuideSyntheticRunQuery(runId);

  if (run.isLoading) return <LoadingBlock lines={6} />;
  if (run.isError || !run.data) {
    return (
      <ErrorPanel what={strings.loadFailed} error={run.error} onRetry={() => void run.refetch()} />
    );
  }
  const { summary } = run.data;
  const verdict = summary.verdict;
  const journeys = summary.journeys ?? [];

  return (
    <div className="flex flex-col gap-8" data-testid="synthetic-detail">
      <section className="flex flex-col gap-2">
        <h3 className="text-xl font-normal text-typography-900">{strings.verdictHeading}</h3>
        {summary.error ? (
          <p className="text-sm text-destructive-600">{strings.errored(summary.error)}</p>
        ) : verdict?.drift ? (
          <>
            <ul
              className="list-disc pl-6 text-sm text-typography-900"
              data-testid="synthetic-reasons"
            >
              {verdict.reasons.map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {verdict.newlyFailing.length > 0 && (
              <p className="text-sm text-typography-800">
                {strings.newlyFailing(verdict.newlyFailing.join(", "))}
              </p>
            )}
            <p className="text-sm text-typography-700">
              {strings.baseline(verdict.baselineMedian)}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-typography-800" data-testid="synthetic-steady">
              {strings.steady}
            </p>
            {verdict && (
              <p className="text-sm text-typography-700">
                {strings.baseline(verdict.baselineMedian)}
              </p>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xl font-normal text-typography-900">{strings.journeysHeading}</h3>
        {journeys.length === 0 ? (
          <p className="text-sm text-typography-700">{strings.noJourneys}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="synthetic-journeys">
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-2 pr-4 font-medium">
                    {strings.journeyColumns.journey}
                  </TableHeader>
                  <TableHeader className="py-2 pr-4 font-medium">
                    {strings.journeyColumns.result}
                  </TableHeader>
                  <TableHeader className="py-2 pr-4 font-medium">
                    {strings.journeyColumns.steps}
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {journeys.map(journey => (
                  <TableRow
                    key={`${journey.key}-${journey.trackId}`}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="synthetic-journey-row"
                  >
                    <TableCell className="py-2 pr-4">{journey.persona || journey.key}</TableCell>
                    <TableCell className="py-2 pr-4">
                      <Pill tone={journey.passed ? "success" : "danger"}>
                        {journey.passed ? strings.passed : strings.failed}
                      </Pill>
                    </TableCell>
                    <TableCell className="py-2 pr-4 text-xs">
                      {journey.steps
                        .map((step, index) => ({ step, index }))
                        .filter(({ step }) => !step.passed)
                        .map(({ step, index }) => (
                          <span key={index} className="block">
                            {strings.stepFailed(
                              index + 1,
                              [
                                ...step.failedChecks,
                                ...(step.safetyFailed ? [strings.stepSafety] : []),
                                ...(step.error ? [step.error] : []),
                              ].join(", "),
                            )}
                          </span>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
};

/**
 * Nightly synthetic journeys on the live release: pass rate, safety failures and whether the night
 * drifted from recent ones. Started on demand with the edit grant. The list refreshes by itself while
 * a night is running; a night opens to its verdict and each journey's failed steps (check names only).
 */
export const SyntheticPanel: React.FC = () => {
  const strings = en.allyConsole.synthetic;
  const { canEdit } = useAllyGuideAccess();
  const [pollMs, setPollMs] = useState(0);
  const runs = useGetAllyGuideSyntheticRunsQuery({ limit: 30 }, { pollingInterval: pollMs });
  const releases = useGetAllyGuideReleasesQuery();
  const [start, { isLoading: isStarting }] = useRunAllyGuideSyntheticMutation();
  const [runOpen, setRunOpen] = useState(false);
  const [openRun, setOpenRun] = useState<AllyGuideSyntheticRun | null>(null);

  const running = (runs.data ?? []).some(run => run.status === "running");
  useEffect(() => {
    setPollMs(running ? POLL_MS : 0);
  }, [running]);

  const releaseLabel = (id: string) => {
    const release = releases.data?.find(item => item.id === id);
    return release ? releaseVersionLabel(release.version) : "—";
  };

  const handleRun = async () => {
    try {
      await start().unwrap();
      toast.success(strings.runDialog.started);
      setRunOpen(false);
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.runDialog.failed));
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="ally-synthetic">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h3 className="text-xl font-normal text-typography-900">{strings.heading}</h3>
          <InfoTip label={strings.help} ariaLabel="About synthetic monitoring" />
        </div>
        {canEdit && (
          <Button kind="tertiary" size="md" onClick={() => setRunOpen(true)}>
            {strings.run}
          </Button>
        )}
      </div>

      {runs.isLoading ? (
        <LoadingBlock lines={4} />
      ) : runs.isError || !runs.data ? (
        <ErrorPanel
          what={strings.loadFailed}
          error={runs.error}
          onRetry={() => void runs.refetch()}
        />
      ) : runs.data.length === 0 ? (
        <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="synthetic-runs">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                {Object.values(strings.columns).map(label => (
                  <TableHeader key={label} className="py-3 pr-4 font-medium">
                    {label}
                  </TableHeader>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.data.map(run => (
                <TableRow
                  key={run.id}
                  onClick={() => setOpenRun(run)}
                  className="cursor-pointer border-b border-border-light align-top text-sm text-typography-900 hover:bg-background-secondary"
                  data-testid="synthetic-run-row"
                >
                  <TableCell className="whitespace-nowrap py-3 pr-4">
                    <button
                      type="button"
                      className="font-medium text-primary-500 hover:underline"
                      aria-label={strings.open(run.night)}
                      onClick={event => {
                        event.stopPropagation();
                        setOpenRun(run);
                      }}
                    >
                      {run.night}
                    </button>
                  </TableCell>
                  <TableCell className="py-3 pr-4">{releaseLabel(run.releaseId)}</TableCell>
                  <TableCell className="py-3 pr-4">
                    <Pill tone={STATUS_TONES[run.status] ?? "neutral"}>
                      {strings.statuses[run.status] ?? run.status}
                    </Pill>
                  </TableCell>
                  <TableCell className="py-3 pr-4 tabular-nums">{run.journeys}</TableCell>
                  <TableCell className="py-3 pr-4 tabular-nums">
                    {formatPercent(run.passRate)}
                  </TableCell>
                  <TableCell className="py-3 pr-4 tabular-nums">{run.safetyFailures}</TableCell>
                  <TableCell className="py-3 pr-4">
                    <Pill tone={run.drift ? "warning" : "neutral"}>
                      {run.drift ? strings.driftYes : strings.driftNo}
                    </Pill>
                  </TableCell>
                  <TableCell className="py-3 pr-4 tabular-nums">{formatUsd(run.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SidePanel
        open={openRun !== null}
        onClose={() => setOpenRun(null)}
        title={
          <h2 className="truncate text-lg font-semibold text-typography-900">
            {openRun ? strings.detail.title(openRun.night) : ""}
          </h2>
        }
        closeLabel={strings.detail.close}
        className="w-[min(860px,100vw)]"
      >
        {openRun && <RunDetail key={openRun.id} runId={openRun.id} />}
      </SidePanel>

      <ConfirmDialog
        isOpen={runOpen}
        title={strings.runDialog.title}
        cancelLabel={strings.runDialog.cancel}
        confirmLabel={isStarting ? strings.runDialog.working : strings.runDialog.confirm}
        isWorking={isStarting}
        onConfirm={() => void handleRun()}
        onClose={() => setRunOpen(false)}
      >
        <p>{strings.runDialog.body}</p>
      </ConfirmDialog>
    </div>
  );
};
