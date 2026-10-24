import React, { useState } from "react";

import { useSelector } from "react-redux";

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
import { useGetAllyGuideBaselinesQuery } from "@api";
import { formatCount, formatPercent } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { RootState } from "@store";
import { AllyGuideBaselineCohort, AllyGuideBaselineSnapshot } from "@types";
import { formatDate, formatDateTime } from "@utils";

import {
  BASELINE_GROUPS,
  BASELINE_LIST_LIMIT,
  BASELINE_METRICS,
  baselineDifference,
  BaselineMetric,
  cohortValue,
  engagementLearningGuard,
  pickSnapshots,
  visibleCohorts,
} from "./baselineCompare";
import { CaptureBaselineDialog } from "./CaptureBaselineDialog";

const DASH = "—";

const formatFigure = (metric: BaselineMetric, value: number | null): string => {
  if (value === null) return DASH;
  switch (metric.kind) {
    case "rate":
      return formatPercent(value);
    case "days":
      return en.allyConsole.baseline.days(value.toFixed(1));
    case "items":
      return value.toFixed(1);
    default:
      return formatCount(value);
  }
};

const DIRECTION_CLASSES = {
  better: "text-success-600",
  worse: "text-destructive-600",
  same: "text-typography-800",
} as const;

interface Column {
  key: string;
  header: string;
  sub: string;
  cohort: AllyGuideBaselineCohort | undefined;
}

const ComparisonTable: React.FC<{
  latest: AllyGuideBaselineSnapshot;
  first: AllyGuideBaselineSnapshot | null;
}> = ({ latest, first }) => {
  const strings = en.allyConsole.baseline;
  const cohortKeys = visibleCohorts(latest);
  const columns: Column[] = [];
  const before = first?.metrics.cohorts.all;
  if (first) {
    columns.push({
      key: "before",
      header: strings.baselineColumn(formatDate(first.createdAt)),
      sub: strings.learners(before?.enrollments ?? 0),
      cohort: before,
    });
  } else {
    const all = latest.metrics.cohorts.all;
    columns.push({
      key: "all",
      header: strings.allColumn,
      sub: strings.learners(all?.enrollments ?? 0),
      cohort: all,
    });
  }
  for (const key of cohortKeys) {
    const cohort = latest.metrics.cohorts[key];
    columns.push({
      key,
      header: strings.cohorts[key] ?? key,
      sub: strings.learners(cohort?.enrollments ?? 0),
      cohort,
    });
  }
  const guided = latest.metrics.cohorts.guided;
  const showDifference = Boolean(first) && Boolean(guided) && (guided?.enrollments ?? 0) > 0;
  const definitions = latest.metrics.definitions ?? {};
  const span = columns.length + 2;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <Table className="w-full border-collapse text-left" data-testid="baseline-table">
          <TableHead>
            <TableRow className="border-b border-border-light text-sm text-typography-700">
              <TableHeader className="py-3 pr-4 font-medium">{strings.measure}</TableHeader>
              {columns.map(column => (
                <TableHeader key={column.key} className="py-3 pr-4 font-medium">
                  <span className="flex flex-col">
                    <span className="inline-flex items-center gap-1">
                      {column.header}
                      {column.key !== "before" &&
                        column.key !== "all" &&
                        column.key === columns[1]?.key && (
                          <InfoTip label={strings.cohortHelp} ariaLabel="About cohorts" />
                        )}
                    </span>
                    <span className="text-xs font-normal">{column.sub}</span>
                  </span>
                </TableHeader>
              ))}
              {showDifference && (
                <TableHeader className="py-3 pr-4 font-medium">{strings.difference}</TableHeader>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {BASELINE_GROUPS.map(group => (
              <React.Fragment key={group}>
                <TableRow className="bg-background-secondary text-sm text-typography-900">
                  <TableCell colSpan={span} className="py-2 pr-4 font-semibold">
                    <span className="inline-flex items-center gap-1">
                      {strings.groups[group]}
                      <InfoTip
                        label={strings.groupHelp[group]}
                        ariaLabel={`About ${strings.groups[group]}`}
                      />
                    </span>
                  </TableCell>
                </TableRow>
                {BASELINE_METRICS.filter(metric => metric.group === group).map(metric => {
                  const diff = showDifference
                    ? baselineDifference(
                        metric,
                        cohortValue(before, metric.key),
                        cohortValue(guided, metric.key),
                      )
                    : null;
                  const label = strings.metrics[metric.key];
                  return (
                    <TableRow
                      key={metric.key}
                      className="border-b border-border-light text-sm text-typography-900"
                      data-testid={`baseline-row-${metric.key}`}
                    >
                      <TableCell className="py-3 pr-4">
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {definitions[metric.key] && (
                            <InfoTip label={definitions[metric.key]} ariaLabel={`About ${label}`} />
                          )}
                        </span>
                      </TableCell>
                      {columns.map(column => (
                        <TableCell key={column.key} className="py-3 pr-4 tabular-nums">
                          {formatFigure(metric, cohortValue(column.cohort, metric.key))}
                          {metric.key === "quizFirstAttemptPassRate" && column.cohort && (
                            <span className="block text-xs text-typography-700">
                              {strings.quizAttempts(column.cohort.quizFirstAttempts)}
                            </span>
                          )}
                        </TableCell>
                      ))}
                      {showDifference && (
                        <TableCell
                          className="py-3 pr-4 tabular-nums"
                          data-testid={`baseline-diff-${metric.key}`}
                        >
                          {diff?.text && diff.direction && (
                            <span className={DIRECTION_CLASSES[diff.direction]}>
                              {diff.text}
                              {diff.direction !== "same" && (
                                <span className="sr-only">
                                  {` (${strings.directions[diff.direction]})`}
                                </span>
                              )}
                            </span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {showDifference ? (
        <p className="text-xs text-typography-700">{strings.smallGroups}</p>
      ) : first ? (
        <p className="text-sm text-typography-700" data-testid="baseline-no-guided">
          {strings.noGuided}
        </p>
      ) : null}
      {definitions.scope && <p className="text-xs text-typography-700">{definitions.scope}</p>}
    </div>
  );
};

/**
 * The pre-launch baseline (plan decision 19): how public courses did before Ally, the number Ally is
 * compared against in place of a held-back group. The first snapshot is the "before"; the latest
 * splits learners by how they entered, so guided learners are set beside it. Engagement and learning
 * sit in separate groups, and a notice appears when engagement is up while quiz passing is lower.
 */
export const BaselineTab: React.FC = () => {
  const strings = en.allyConsole.baseline;
  const { canEdit } = useAllyGuideAccess();
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideBaselinesQuery({
    limit: BASELINE_LIST_LIMIT,
  });
  const [captureOpen, setCaptureOpen] = useState(false);

  const captureButton = canEdit ? (
    <Button kind="primary" size="md" onClick={() => setCaptureOpen(true)}>
      {strings.capture}
    </Button>
  ) : null;
  const dialog = (
    <CaptureBaselineDialog isOpen={captureOpen} onClose={() => setCaptureOpen(false)} />
  );

  if (isLoading) return <LoadingBlock lines={6} />;
  if (isError || !data) {
    return <ErrorPanel what="the baseline" error={error} onRetry={() => void refetch()} />;
  }

  const { latest, first } = pickSnapshots(data);
  if (!latest) {
    return (
      <div className="flex flex-col items-center gap-3" data-testid="ally-baseline">
        <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
        {captureButton}
        {dialog}
      </div>
    );
  }

  const who = (id: number | null, name?: string | null): string =>
    id === null || id === undefined
      ? strings.by.unknown
      : currentUserId !== null && currentUserId !== undefined && Number(currentUserId) === id
        ? strings.by.you
        : name?.trim() || strings.by.user(id);
  const guard = first ? engagementLearningGuard(first, latest) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="ally-baseline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-typography-700">{strings.intro}</p>
        {captureButton}
      </div>

      <p className="text-sm text-typography-900" data-testid="baseline-latest-summary">
        {strings.latestSummary(
          formatDateTime(latest.createdAt),
          who(latest.capturedByUserId, latest.capturedByName),
          latest.windowDays,
          latest.metrics.publicCourses,
        )}
      </p>
      {!first && (
        <p className="text-sm text-typography-800" data-testid="baseline-only-one">
          {strings.onlyOne}
        </p>
      )}

      {guard?.triggered && (
        <div data-testid="baseline-guard">
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title={strings.guard.title}
            subtitle={`${strings.guard.body(
              guard.improved.map(key => strings.metrics[key]).join(", "),
              formatPercent(guard.baselinePass),
              formatPercent(guard.guidedPass),
            )} ${strings.guard.sizes(
              guard.guidedEnrollments,
              guard.baselineEnrollments,
              guard.guidedQuizAttempts,
            )}`}
          />
        </div>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="baseline-compare-heading">
        <div className="flex items-center gap-1">
          <h3 id="baseline-compare-heading" className="text-xl font-normal text-typography-900">
            {strings.compareHeading}
          </h3>
          <InfoTip label={strings.compareHelp} ariaLabel="About the comparison" />
        </div>
        <ComparisonTable latest={latest} first={first} />
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="baseline-history-heading">
        <div className="flex items-center gap-1">
          <h3 id="baseline-history-heading" className="text-xl font-normal text-typography-900">
            {strings.historyHeading}
          </h3>
          <InfoTip label={strings.historyHelp} ariaLabel="About snapshots" />
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="baseline-history">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.historyColumns.taken}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.historyColumns.by}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.historyColumns.window}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.historyColumns.enrollments}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.historyColumns.note}
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map(snapshot => (
                <TableRow
                  key={snapshot.id}
                  className="border-b border-border-light align-top text-sm text-typography-900"
                  data-testid="baseline-snapshot-row"
                >
                  <TableCell className="whitespace-nowrap py-3 pr-4">
                    {formatDateTime(snapshot.createdAt)}
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    {who(snapshot.capturedByUserId, snapshot.capturedByName)}
                  </TableCell>
                  <TableCell className="py-3 pr-4">{strings.window(snapshot.windowDays)}</TableCell>
                  <TableCell className="py-3 pr-4 tabular-nums">
                    {formatCount(snapshot.metrics.cohorts.all?.enrollments ?? 0)}
                  </TableCell>
                  <TableCell className="max-w-md break-words py-3 pr-4">
                    {snapshot.note ?? <span className="text-typography-700">{strings.noNote}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      {dialog}
    </div>
  );
};
