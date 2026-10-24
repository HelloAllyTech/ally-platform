import React, { useState } from "react";

import {
  Button,
  InlineNotification,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import {
  formatCount,
  formatMs,
  formatPercent,
  formatUsd,
  releaseVersionLabel,
} from "@components/ally-guide/allyGuideFormat";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideOverview } from "@types";

import {
  armValue,
  canaryLearningGuard,
  COMPARISON_METRICS,
  compare,
  ComparisonMetric,
  DifferenceDirection,
  hasEnoughTurns,
  MIN_TURNS_TO_COMPARE,
  pickArms,
} from "./canaryComparison";
import { CanaryDecision } from "./CanaryDecision";
import { PromoteReleaseDialog, StopCanaryDialog } from "./ReleaseDialogs";

const DASH = "—";

/** A figure as its row's unit says: a count, a rate, a time, dollars, or a per-100-turns count. */
const formatFigure = (metric: ComparisonMetric, value: number | null): string => {
  if (value === null) return DASH;
  switch (metric.kind) {
    case "rate":
      return formatPercent(value);
    case "ms":
      return formatMs(value);
    case "usd":
      return formatUsd(value);
    case "per100":
    case "items":
      return value.toFixed(1);
    default:
      return formatCount(value);
  }
};

const DIRECTION_CLASSES: Record<DifferenceDirection, string> = {
  better: "text-success-600",
  worse: "text-destructive-600",
  same: "text-typography-800",
  differs: "text-typography-800",
};

interface CanaryMonitorProps {
  canary: AllyGuideOverview["canary"];
  live: AllyGuideOverview["release"];
  arms: AllyGuideOverview["arms"];
}

/**
 * The canary set beside the live release over the window: live first, the canary beside it, and the
 * canary's difference in the metric's own unit. Which way is good is told in words (the sign and a
 * hidden label), never by colour alone, and colour is withheld altogether while the canary has too
 * few turns to mean anything, so noise is not painted green or red.
 *
 * Promote and stop are the person's decision in this milestone: nothing here decides. Learning is not
 * measured per arm, and the note says so rather than leaving a green board to imply it is fine.
 */
export const CanaryMonitor: React.FC<CanaryMonitorProps> = ({ canary, live, arms }) => {
  const strings = en.allyConsole.overview.canary;
  const { canEdit } = useAllyGuideAccess();
  const [promoting, setPromoting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const { ga, canary: canaryArm } = pickArms(arms);
  const enough = hasEnoughTurns(canaryArm);
  const guard = canaryLearningGuard(ga, canaryArm);
  const liveLabel = live ? releaseVersionLabel(live.version) : null;
  const canaryLabel = canary ? releaseVersionLabel(canary.version) : "";

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="ally-canary-heading"
      data-testid="ally-canary-monitor"
    >
      <div className="flex items-center gap-1">
        <h3 id="ally-canary-heading" className="text-xl font-normal text-typography-900">
          {strings.title}
        </h3>
        <InfoTip label={strings.help} ariaLabel="About the canary" />
      </div>

      {!canary ? (
        <div data-testid="canary-none">
          <p className="text-sm text-typography-900">{strings.none}</p>
          <p className="text-sm text-typography-700">{strings.noneDetail}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-typography-900" data-testid="canary-summary">
              {strings.summary(canaryLabel, canary.percent, liveLabel)}
            </p>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button kind="primary" size="md" onClick={() => setPromoting(true)}>
                  {strings.promote}
                </Button>
                <Button kind="danger--tertiary" size="md" onClick={() => setStopping(true)}>
                  {strings.stop}
                </Button>
              </div>
            )}
          </div>

          <CanaryDecision />

          {!canaryArm ? (
            <p className="text-sm text-typography-700" data-testid="canary-not-served">
              {strings.notServed}
            </p>
          ) : (
            !enough && (
              <p className="text-sm text-typography-800" data-testid="canary-too-few">
                {strings.tooFew(canaryArm.turns, MIN_TURNS_TO_COMPARE)}
              </p>
            )
          )}

          {guard?.triggered && (
            <div data-testid="canary-guard">
              <InlineNotification
                kind="warning"
                lowContrast
                hideCloseButton
                title={strings.guard.title}
                subtitle={`${strings.guard.body(
                  guard.engagementUp.map(key => strings.guard.measures[key]).join(", "),
                  formatPercent(guard.gaPass),
                  formatPercent(guard.canaryPass),
                )} ${strings.guard.sizes(guard.canaryQuizAttempts)}`}
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="canary-table">
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-3 pr-4 font-medium">{strings.measure}</TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.gaColumn(liveLabel)}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.canaryColumn(canaryLabel)}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">{strings.difference}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {COMPARISON_METRICS.map(metric => {
                  const copy = strings.metrics[metric.key];
                  const gaValue = armValue(ga, metric);
                  const canaryValue = armValue(canaryArm, metric);
                  const difference = compare(metric, gaValue, canaryValue);
                  return (
                    <TableRow
                      key={metric.key}
                      className="border-b border-border-light text-sm text-typography-900"
                      data-testid={`canary-row-${metric.key}`}
                    >
                      <TableCell className="py-3 pr-4">
                        <span className="inline-flex items-center gap-1">
                          {copy.label}
                          <InfoTip label={copy.help} ariaLabel={`About ${copy.label}`} />
                        </span>
                      </TableCell>
                      <TableCell className="py-3 pr-4 tabular-nums">
                        {formatFigure(metric, gaValue)}
                      </TableCell>
                      <TableCell className="py-3 pr-4 tabular-nums">
                        {formatFigure(metric, canaryValue)}
                      </TableCell>
                      <TableCell
                        className="py-3 pr-4 tabular-nums"
                        data-testid={`canary-diff-${metric.key}`}
                      >
                        {difference.text && difference.direction && (
                          <span
                            className={enough ? DIRECTION_CLASSES[difference.direction] : undefined}
                          >
                            {difference.text}
                            {difference.direction !== "same" && (
                              <span className="sr-only">
                                {` (${strings.directions[difference.direction]})`}
                              </span>
                            )}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <p className="max-w-3xl text-xs text-typography-700">{strings.scope}</p>
        </>
      )}

      <PromoteReleaseDialog
        release={promoting && canary ? { id: canary.id, version: canary.version } : null}
        current={live ? { id: live.id, version: live.version } : null}
        canary={canary ? { id: canary.id, version: canary.version } : null}
        onClose={() => setPromoting(false)}
      />
      <StopCanaryDialog
        canary={stopping && canary ? { id: canary.id, version: canary.version } : null}
        live={live ? { id: live.id, version: live.version } : null}
        onClose={() => setStopping(false)}
      />
    </section>
  );
};
