import React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideCanaryDecisionQuery } from "@api";
import { formatPercent } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { en } from "@constants";

import { humanise } from "./loopFormat";

const VERDICT_TONES: Record<string, PillTone> = {
  wait: "neutral",
  promote: "success",
  revert: "danger",
};

/**
 * The running canary's automatic verdict: wait, promote or revert, and the reasons, with every
 * threshold's actual against its requirement, the criteria it counts (only those whose judges agree
 * with people), and the learning guard. It says whether the verdict would act on its own at the
 * current delegation stage, so nobody reads "promote" as an instruction that has been or will be
 * carried out when a person still has to do it. Read-only: promoting and stopping stay with the
 * buttons beside it.
 */
export const CanaryDecision: React.FC = () => {
  const strings = en.allyConsole.overview.canary.decision;
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideCanaryDecisionQuery();

  if (isLoading) return <LoadingBlock lines={3} />;
  if (isError || !data) {
    return <ErrorPanel what={strings.loadFailed} error={error} onRetry={() => void refetch()} />;
  }
  if (!data.canary || !data.decision) return null;

  const { decision, evidence } = data;
  const thresholds = Object.entries(decision.thresholds);

  return (
    <div
      className="flex flex-col gap-3 border border-border-light p-3"
      data-testid="canary-decision"
    >
      <div className="flex items-center gap-1">
        <h4 className="text-lg font-normal text-typography-900">{strings.heading}</h4>
        <InfoTip label={strings.help} ariaLabel="About the pipeline's verdict" />
      </div>

      <p
        className="flex flex-wrap items-center gap-2 text-sm text-typography-900"
        data-testid="canary-verdict"
      >
        <Pill tone={VERDICT_TONES[decision.action] ?? "neutral"}>
          {strings.verdicts[decision.action] ?? decision.action}
        </Pill>
        {strings.verdict(strings.verdicts[decision.action] ?? decision.action)}
      </p>
      {decision.emergency && (
        <p className="text-sm font-semibold text-destructive-600" data-testid="canary-emergency">
          {strings.emergency}
        </p>
      )}
      {decision.reasons.length > 0 && (
        <ul className="list-disc pl-6 text-sm text-typography-800" data-testid="canary-reasons">
          {decision.reasons.map(reason => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {!decision.ready && (
        <p className="text-sm text-typography-800" data-testid="canary-not-ready">
          {strings.notReady}
        </p>
      )}
      <p className="text-sm text-typography-700" data-testid="canary-stage">
        {data.stage !== undefined && strings.stage(data.stage, Boolean(data.promotesAutomatically))}
        {evidence ? ` ${strings.daysRunning(evidence.daysRunning)}` : ""}
      </p>

      {thresholds.length > 0 && (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="canary-thresholds">
            <TableHead>
              <TableRow className="border-b border-border-light text-xs text-typography-700">
                <TableHeader className="py-1 pr-4 font-medium">
                  {strings.thresholdColumns.threshold}
                </TableHeader>
                <TableHeader className="py-1 pr-4 font-medium">
                  {strings.thresholdColumns.need}
                </TableHeader>
                <TableHeader className="py-1 pr-4 font-medium">
                  {strings.thresholdColumns.have}
                </TableHeader>
                <TableHeader className="py-1 pr-4 font-medium">
                  {strings.thresholdColumns.met}
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {thresholds.map(([key, value]) => (
                <TableRow
                  key={key}
                  className="border-b border-border-light text-sm"
                  data-testid={`canary-threshold-${key}`}
                >
                  <TableCell className="py-1 pr-4">{humanise(key)}</TableCell>
                  <TableCell className="py-1 pr-4 tabular-nums">{value.need}</TableCell>
                  <TableCell className="py-1 pr-4 tabular-nums">{value.have}</TableCell>
                  <TableCell className="py-1 pr-4">
                    {value.met ? strings.met : strings.notMet}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div>
        <h5 className="text-sm font-semibold text-typography-900">{strings.criteriaHeading}</h5>
        {decision.criteria.length === 0 ? (
          <p className="text-sm text-typography-700" data-testid="canary-no-criteria">
            {strings.noCriteria}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="canary-criteria">
              <TableHead>
                <TableRow className="border-b border-border-light text-xs text-typography-700">
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.criteriaColumns.criterion}
                  </TableHeader>
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.criteriaColumns.live}
                  </TableHeader>
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.criteriaColumns.canary}
                  </TableHeader>
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.criteriaColumns.verdict}
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {decision.criteria.map(criterion => (
                  <TableRow
                    key={criterion.id}
                    className="border-b border-border-light text-sm"
                    data-testid={`canary-criterion-${criterion.id}`}
                  >
                    <TableCell className="py-1 pr-4">{humanise(criterion.id)}</TableCell>
                    <TableCell className="py-1 pr-4 tabular-nums">
                      {formatPercent(criterion.gaRate)}
                    </TableCell>
                    <TableCell className="py-1 pr-4 tabular-nums">
                      {formatPercent(criterion.canaryRate)}
                    </TableCell>
                    <TableCell className="py-1 pr-4">
                      {strings.criterionVerdicts[criterion.verdict] ?? criterion.verdict}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <p className="text-sm text-typography-800" data-testid="canary-guard">
        {strings.guard[decision.guard.status] ?? decision.guard.status}
        {decision.guard.reason ? ` ${decision.guard.reason}` : ""}
      </p>
    </div>
  );
};
