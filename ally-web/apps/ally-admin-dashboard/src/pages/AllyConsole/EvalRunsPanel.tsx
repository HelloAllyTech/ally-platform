import React, { useMemo, useState } from "react";

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
  useGetAllyGuideEvalCasesQuery,
  useGetAllyGuideEvalRunOutputsQuery,
  useGetAllyGuideEvalRunQuery,
  useGetAllyGuideEvalRunsQuery,
  useGetAllyGuideReleasesQuery,
} from "@api";
import { formatUsd, releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideEvalResult, AllyGuideEvalRun } from "@types";
import { formatDateTime } from "@utils";

const POLL_MS = 5000;
const IN_FLIGHT = new Set(["queued", "running"]);

const STATUS_TONES: Record<string, PillTone> = {
  queued: "neutral",
  running: "info",
  passed: "success",
  failed: "danger",
  error: "danger",
};

const groupByCase = (results: AllyGuideEvalResult[]) => {
  const groups = new Map<string, AllyGuideEvalResult[]>();
  for (const result of results) {
    groups.set(result.caseId, [...(groups.get(result.caseId) ?? []), result]);
  }
  return [...groups.entries()];
};

const RunDetail: React.FC<{ runId: string }> = ({ runId }) => {
  const strings = en.allyConsole.evals.runs.detail;
  const { canReadTranscripts } = useAllyGuideAccess();
  const [pollMs, setPollMs] = useState(0);
  const run = useGetAllyGuideEvalRunQuery(runId, { pollingInterval: pollMs });
  const runStatus = run.data?.run.status ?? "";
  React.useEffect(() => {
    setPollMs(IN_FLIGHT.has(runStatus) ? POLL_MS : 0);
  }, [runStatus]);
  const cases = useGetAllyGuideEvalCasesQuery({ limit: 500 });
  const [showReplies, setShowReplies] = useState(false);
  const outputs = useGetAllyGuideEvalRunOutputsQuery(runId, { skip: !showReplies });

  const titles = useMemo(
    () => Object.fromEntries((cases.data ?? []).map(item => [item.id, item.title])),
    [cases.data],
  );

  if (run.isLoading) return <LoadingBlock lines={6} />;
  if (run.isError || !run.data) {
    return (
      <ErrorPanel what={strings.loadFailed} error={run.error} onRetry={() => void run.refetch()} />
    );
  }

  const { run: detail, results } = run.data;
  const decision = detail.summary.decision;
  const repliesById = new Map(
    (outputs.data ?? []).map(result => [result.id, result.output?.reply]),
  );

  return (
    <div className="flex flex-col gap-8" data-testid="eval-run-detail">
      <section className="flex flex-col gap-2" aria-labelledby="run-decision-heading">
        <h3 id="run-decision-heading" className="text-xl font-normal text-typography-900">
          {strings.decisionHeading}
        </h3>
        {decision ? (
          <>
            <p
              className={`text-base font-semibold ${decision.passed ? "text-success-600" : "text-destructive-600"}`}
              data-testid="run-decision"
            >
              {decision.passed ? strings.passed : strings.failed}
            </p>
            {decision.reasons.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-typography-900">
                  {strings.reasonsHeading}
                </h4>
                <ul
                  className="list-disc pl-6 text-sm text-typography-800"
                  data-testid="run-reasons"
                >
                  {decision.reasons.map(reason => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-typography-800">{strings.safety(decision.safetyFailures)}</p>
            <p className="text-sm text-typography-800">
              {strings.quality(
                decision.quality.candidateCasesPassed,
                decision.quality.baselineCasesPassed,
                decision.quality.qualityCases,
              )}
            </p>
            {decision.target && (
              <p className="text-sm text-typography-800">
                {strings.target(
                  decision.target.candidate,
                  decision.target.baseline,
                  decision.target.cases,
                )}
              </p>
            )}
            <p className="text-sm text-typography-800" data-testid="run-guard">
              {strings.guard[decision.guard.status] ?? decision.guard.status}
              {decision.guard.reason ? ` ${decision.guard.reason}` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-typography-700">{strings.notDecided}</p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="run-results-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <h3 id="run-results-heading" className="text-xl font-normal text-typography-900">
              {strings.resultsHeading}
            </h3>
            <InfoTip label={strings.resultsHelp} ariaLabel="About results" />
          </div>
          {canReadTranscripts ? (
            <Button kind="tertiary" size="sm" onClick={() => setShowReplies(value => !value)}>
              {showReplies ? strings.hideReplies : strings.showReplies}
            </Button>
          ) : (
            <span className="text-xs text-typography-700">{strings.repliesNeedTranscripts}</span>
          )}
        </div>
        {showReplies && outputs.isError && (
          <ErrorPanel
            what="the replies"
            error={outputs.error}
            onRetry={() => void outputs.refetch()}
          />
        )}
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="run-results">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.resultColumns.case}
                </TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.resultColumns.passed}
                </TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.resultColumns.failedChecks}
                </TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.resultColumns.cost}
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {groupByCase(results).map(([caseId, reps]) => {
                const passed = reps.filter(rep => rep.passed).length;
                const failedChecks = [
                  ...new Set(reps.flatMap(rep => rep.failedChecks.map(check => check.id))),
                ];
                const errors = reps
                  .map(rep => rep.error)
                  .filter((error): error is string => Boolean(error));
                return (
                  <TableRow
                    key={caseId}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="run-result-row"
                  >
                    <TableCell className="max-w-md break-words py-2 pr-4">
                      {titles[caseId] ?? strings.unknownCase}
                      {reps.some(rep => rep.safetyFailed) && (
                        <span className="ml-2">
                          <Pill tone="danger">{en.allyConsole.evals.cases.safety}</Pill>
                        </span>
                      )}
                      {showReplies &&
                        reps.map(rep => (
                          <span key={rep.id} className="mt-1 block text-xs text-typography-700">
                            {strings.repetition(rep.repetition)}:{" "}
                            {repliesById.get(rep.id) ?? strings.noReply}
                          </span>
                        ))}
                    </TableCell>
                    <TableCell className="py-2 pr-4 tabular-nums">
                      {strings.passedOf(passed, reps.length)}
                    </TableCell>
                    <TableCell className="py-2 pr-4 font-mono text-xs">
                      {failedChecks.length ? failedChecks.join(", ") : strings.noFailed}
                      {errors.length > 0 && (
                        <span className="block font-sans text-destructive-600">
                          {strings.error(errors[0])}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 pr-4 tabular-nums">
                      {formatUsd(reps.reduce((sum, rep) => sum + rep.costUsd, 0))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
};

/**
 * Eval runs, newest first, with each one's gate decision, and a drawer for one run's reasons and
 * per-case results. The list refreshes by itself while any run is queued or running: a run lasts
 * minutes and is started in the background. Replayed replies can echo a learner's redacted words, so
 * they are fetched only on request and only with the transcripts grant.
 */
export const EvalRunsPanel: React.FC = () => {
  const strings = en.allyConsole.evals.runs;
  const [pollMs, setPollMs] = useState(0);
  const runs = useGetAllyGuideEvalRunsQuery(undefined, { pollingInterval: pollMs });
  const releases = useGetAllyGuideReleasesQuery();
  const [openRun, setOpenRun] = useState<AllyGuideEvalRun | null>(null);

  const inFlight = (runs.data ?? []).some(run => IN_FLIGHT.has(run.status));
  React.useEffect(() => {
    setPollMs(inFlight ? POLL_MS : 0);
  }, [inFlight]);

  const releaseLabel = (id: string) => {
    const release = releases.data?.find(item => item.id === id);
    return release ? releaseVersionLabel(release.version) : "—";
  };

  if (runs.isLoading) return <LoadingBlock lines={5} />;
  if (runs.isError || !runs.data) {
    return (
      <ErrorPanel
        what={strings.loadFailed}
        error={runs.error}
        onRetry={() => void runs.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="ally-eval-runs">
      <div className="flex items-center gap-1">
        <h3 className="text-xl font-normal text-typography-900">{strings.heading}</h3>
        <InfoTip label={strings.help} ariaLabel="About eval runs" />
      </div>
      {inFlight && (
        <p className="text-xs text-typography-700" data-testid="runs-refreshing">
          {strings.refreshing}
        </p>
      )}

      {runs.data.length === 0 ? (
        <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="eval-runs-table">
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
              {runs.data.map(run => {
                const label = releaseLabel(run.releaseId);
                const kind = strings.kinds[run.kind] ?? run.kind;
                return (
                  <TableRow
                    key={run.id}
                    onClick={() => setOpenRun(run)}
                    className="cursor-pointer border-b border-border-light align-top text-sm text-typography-900 hover:bg-background-secondary"
                    data-testid="eval-run-row"
                  >
                    <TableCell className="py-3 pr-4">
                      <button
                        type="button"
                        className="font-medium text-primary-500 hover:underline"
                        aria-label={strings.open(label, kind)}
                        onClick={event => {
                          event.stopPropagation();
                          setOpenRun(run);
                        }}
                      >
                        {label}
                      </button>
                    </TableCell>
                    <TableCell className="py-3 pr-4">{kind}</TableCell>
                    <TableCell className="py-3 pr-4">
                      <Pill tone={STATUS_TONES[run.status] ?? "neutral"}>
                        {strings.statuses[run.status] ?? run.status}
                      </Pill>
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {strings.cases(run.caseCount, run.repetitions)}
                    </TableCell>
                    <TableCell className="py-3 pr-4 tabular-nums">
                      {formatUsd(run.costUsd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-3 pr-4">
                      {formatDateTime(run.startedAt ?? run.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <SidePanel
        open={openRun !== null}
        onClose={() => setOpenRun(null)}
        title={
          <h2 className="truncate text-lg font-semibold text-typography-900">
            {openRun
              ? strings.detail.title(
                  releaseLabel(openRun.releaseId),
                  strings.kinds[openRun.kind] ?? openRun.kind,
                )
              : ""}
          </h2>
        }
        closeLabel={strings.detail.close}
        className="w-[min(860px,100vw)]"
      >
        {openRun && <RunDetail key={openRun.id} runId={openRun.id} />}
      </SidePanel>
    </div>
  );
};
