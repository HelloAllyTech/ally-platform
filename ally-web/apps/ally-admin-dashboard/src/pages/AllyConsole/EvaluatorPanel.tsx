import React, { useState } from "react";

import { toast } from "sonner";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideEvaluatorSummaryQuery,
  useGetAllyGuideKappaQuery,
  useGetAllyGuideRubricQuery,
  useRunAllyGuideEvaluatorMutation,
} from "@api";
import { formatCount, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideCriterionAgreement } from "@types";
import { getErrorMessage } from "@utils";

const SUMMARY_DAYS = 14;
const NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const Heading: React.FC<{ id: string; text: string; help?: string }> = ({ id, text, help }) => (
  <div className="flex items-center gap-1">
    <h3 id={id} className="text-xl font-normal text-typography-900">
      {text}
    </h3>
    {help && <InfoTip label={help} ariaLabel={`About ${text}`} />}
  </div>
);

/**
 * The nightly evaluator and whether its judges can be trusted: the nights it has judged, what its
 * rule checks and model judges failed, κ per criterion against the people who labelled, and the
 * rubric they all grade. Counts only: no learner text is here. "Run now" needs the edit grant.
 */
export const EvaluatorPanel: React.FC = () => {
  const strings = en.allyConsole.evals.evaluator;
  const { canEdit } = useAllyGuideAccess();
  const summary = useGetAllyGuideEvaluatorSummaryQuery({ days: SUMMARY_DAYS });
  const kappa = useGetAllyGuideKappaQuery();
  const rubric = useGetAllyGuideRubricQuery();
  const [run, { isLoading: isRunning }] = useRunAllyGuideEvaluatorMutation();

  const [runOpen, setRunOpen] = useState(false);
  const [night, setNight] = useState("");
  const nightInvalid = night.trim() !== "" && !NIGHT_PATTERN.test(night.trim());

  const labels = Object.fromEntries((rubric.data?.criteria ?? []).map(c => [c.id, c.label]));
  const criterionName = (id: string) => labels[id] ?? id;

  const closeRun = () => {
    setRunOpen(false);
    setNight("");
  };
  const handleRun = async () => {
    if (nightInvalid) return;
    try {
      await run({ night: night.trim() || undefined }).unwrap();
      toast.success(strings.runDialog.started);
      closeRun();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.runDialog.failed));
    }
  };

  const agreementCell = (row: AllyGuideCriterionAgreement | undefined) =>
    row ? strings.kappaCell(row.kappa, row.agreement, row.pairs) : "—";

  return (
    <div className="flex flex-col gap-10" data-testid="ally-evaluator">
      <section className="flex flex-col gap-3" aria-labelledby="evaluator-nights-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading id="evaluator-nights-heading" text={strings.heading} help={strings.help} />
          {canEdit && (
            <Button kind="tertiary" size="md" onClick={() => setRunOpen(true)}>
              {strings.run}
            </Button>
          )}
        </div>
        {summary.isLoading ? (
          <LoadingBlock lines={4} />
        ) : summary.isError || !summary.data ? (
          <ErrorPanel
            what="the evaluator summary"
            error={summary.error}
            onRetry={() => void summary.refetch()}
          />
        ) : (
          <>
            <p className="text-sm text-typography-800" data-testid="evaluator-spent">
              {strings.spentToday(formatUsd(summary.data.spentTodayUsd))}
            </p>
            {summary.data.nights.length === 0 ? (
              <EmptyPanel title={strings.nightsEmpty} />
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full border-collapse text-left" data-testid="evaluator-nights">
                  <TableHead>
                    <TableRow className="border-b border-border-light text-sm text-typography-700">
                      {Object.entries(strings.columns).map(([key, label]) => (
                        <TableHeader key={key} className="py-3 pr-4 font-medium">
                          {label}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summary.data.nights.map(night => (
                      <TableRow
                        key={night.night}
                        className="border-b border-border-light text-sm text-typography-900"
                        data-testid="evaluator-night-row"
                      >
                        <TableCell className="whitespace-nowrap py-3 pr-4">{night.night}</TableCell>
                        <TableCell className="py-3 pr-4 tabular-nums">
                          {formatCount(night.windows)}
                        </TableCell>
                        <TableCell className="py-3 pr-4 tabular-nums">
                          {formatCount(night.judged)}
                        </TableCell>
                        <TableCell className="py-3 pr-4 tabular-nums">
                          {formatCount(night.flagged)}
                        </TableCell>
                        <TableCell className="py-3 pr-4 tabular-nums">
                          {formatCount(night.safetyFlags)}
                        </TableCell>
                        <TableCell className="py-3 pr-4 tabular-nums">
                          {formatCount(night.disagreements)}
                        </TableCell>
                        <TableCell className="py-3 pr-4 tabular-nums">
                          {formatCount(night.errors)}
                        </TableCell>
                        <TableCell className="py-3 pr-4 tabular-nums">
                          {formatUsd(night.costUsd)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <FailureTable
                heading={strings.checksHeading}
                rows={summary.data.checks}
                nameOf={id => id}
                empty={strings.noChecks}
                testId="evaluator-checks"
              />
              <FailureTable
                heading={strings.criteriaHeading}
                rows={summary.data.criteria}
                nameOf={criterionName}
                empty={strings.noChecks}
                testId="evaluator-criteria"
              />
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="evaluator-kappa-heading">
        <Heading
          id="evaluator-kappa-heading"
          text={strings.kappaHeading}
          help={strings.kappaHelp}
        />
        {kappa.isLoading ? (
          <LoadingBlock lines={4} />
        ) : kappa.isError || !kappa.data ? (
          <ErrorPanel
            what="the agreement"
            error={kappa.error}
            onRetry={() => void kappa.refetch()}
          />
        ) : (
          <>
            <p className="text-sm text-typography-800" data-testid="kappa-summary">
              {strings.kappaSummary(
                kappa.data.threshold,
                kappa.data.minPairs,
                kappa.data.labelledReviews,
              )}
            </p>
            <div className="overflow-x-auto">
              <Table className="w-full border-collapse text-left" data-testid="kappa-table">
                <TableHead>
                  <TableRow className="border-b border-border-light text-sm text-typography-700">
                    <TableHeader className="py-3 pr-4 font-medium">
                      {strings.kappaColumns.criterion}
                    </TableHeader>
                    <TableHeader className="py-3 pr-4 font-medium">
                      {strings.kappaColumns.critic}
                    </TableHeader>
                    <TableHeader className="py-3 pr-4 font-medium">
                      {strings.kappaColumns.verifier}
                    </TableHeader>
                    <TableHeader className="py-3 pr-4 font-medium">
                      {strings.kappaColumns.trusted}
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {kappa.data.critic.map(critic => {
                    const verifier = kappa.data?.verifier.find(
                      row => row.criterion === critic.criterion,
                    );
                    return (
                      <TableRow
                        key={critic.criterion}
                        className="border-b border-border-light align-top text-sm text-typography-900"
                        data-testid={`kappa-row-${critic.criterion}`}
                      >
                        <TableCell className="py-3 pr-4">
                          {criterionName(critic.criterion)}
                        </TableCell>
                        <TableCell className="py-3 pr-4">{agreementCell(critic)}</TableCell>
                        <TableCell className="py-3 pr-4">{agreementCell(verifier)}</TableCell>
                        <TableCell className="py-3 pr-4">
                          <Pill tone={critic.trusted ? "success" : "neutral"} title={critic.reason}>
                            {critic.trusted ? strings.trusted : strings.excluded}
                          </Pill>
                          {!critic.trusted && (
                            <span className="block text-xs text-typography-700">
                              {critic.reason}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="evaluator-rubric-heading">
        <Heading
          id="evaluator-rubric-heading"
          text={strings.rubricHeading}
          help={strings.rubricHelp}
        />
        {rubric.isLoading ? (
          <LoadingBlock lines={3} />
        ) : rubric.isError || !rubric.data ? (
          <ErrorPanel
            what="the rubric"
            error={rubric.error}
            onRetry={() => void rubric.refetch()}
          />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="evaluator-rubric">
            {rubric.data.criteria.map(criterion => (
              <li key={criterion.id}>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-typography-900">
                    {criterion.label}
                    {criterion.safety && (
                      <span className="ml-2">
                        <Pill tone="warning">{strings.safetyCriterion}</Pill>
                      </span>
                    )}
                  </summary>
                  <p className="mt-1 text-sm text-typography-800">
                    <span className="font-medium">{strings.pass}: </span>
                    {criterion.pass}
                  </p>
                  <p className="text-sm text-typography-800">
                    <span className="font-medium">{strings.fail}: </span>
                    {criterion.fail}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        isOpen={runOpen}
        title={strings.runDialog.title}
        cancelLabel={strings.runDialog.cancel}
        confirmLabel={isRunning ? strings.runDialog.working : strings.runDialog.confirm}
        confirmDisabled={nightInvalid}
        isWorking={isRunning}
        onConfirm={() => void handleRun()}
        onClose={closeRun}
      >
        <p>{strings.runDialog.body}</p>
        <TextInput
          id="evaluator-run-night"
          labelText={strings.runDialog.nightLabel}
          helperText={strings.runDialog.nightHelp}
          placeholder="2026-10-23"
          invalid={nightInvalid}
          invalidText={strings.runDialog.nightInvalid}
          value={night}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNight(event.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
};

const FailureTable: React.FC<{
  heading: string;
  rows: { id: string; failed: number; applicable: number }[];
  nameOf: (id: string) => string;
  empty: string;
  testId: string;
}> = ({ heading, rows, nameOf, empty, testId }) => {
  const strings = en.allyConsole.evals.evaluator;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-lg font-normal text-typography-900">{heading}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-typography-700">{empty}</p>
      ) : (
        <Table className="w-full border-collapse text-left" data-testid={testId}>
          <TableBody>
            {rows.map(row => (
              <TableRow
                key={row.id}
                className="border-b border-border-light text-sm text-typography-900"
              >
                <TableCell className="py-2 pr-4">{nameOf(row.id)}</TableCell>
                <TableCell className="py-2 pr-4 tabular-nums">
                  {strings.failedOf(row.failed, row.applicable)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
