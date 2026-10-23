import React, { useEffect, useMemo, useState } from "react";

import { FailIcon, Launch, Minus, PauseIcon, Refresh, Tick, Timer } from "@icons";

import { ActionableNotification, Button } from "@ally-ui-mono/ui-shared";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { ROUTES, en } from "@constants";
import type {
  CourseBlueprint,
  CourseCopilotJob,
  CourseCopilotJobStatus,
  CourseCopilotSessionDetail,
} from "@types";
import { asAgentText } from "@utils";

import { asArray, formatElapsed, formatUsd } from "./courseCopilotFormat";
import { CourseOutlinePanel } from "./CourseOutlinePanel";
import { RaiseCeilingDialog } from "./RaiseCeilingDialog";

export interface BuildPanelProps {
  detail: CourseCopilotSessionDetail;
  flashItemIds?: string[];
  /** Omit `jobIds` to retry every failed or skipped job. */
  onRetryJobs: (jobIds?: string[]) => Promise<void>;
  onCancelBuild: () => Promise<void>;
  onRaiseBudget: (budgetUsd: number) => Promise<boolean>;
  onOpenEditor: () => void;
  /** Why "Open in editor" is off (the copilot overwrites edits made during a build). */
  openEditorDisabledReason?: string | null;
}

/** Statuses a job can still change out of — while any exist the build is live and elapsed time ticks. */
const LIVE_JOB_STATUSES: CourseCopilotJobStatus[] = ["queued", "running", "held"];

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
};

/**
 * Wall-clock time that advances only while there is something to count. A build that
 * has finished, or a tab showing history, stays still — a clock running over a stopped
 * build manufactures the appearance of progress.
 */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);
  return now;
};

interface JobGroup {
  key: string;
  title: string;
  jobs: CourseCopilotJob[];
}

/**
 * Jobs grouped under the section they write into, in blueprint order; course-wide jobs
 * (details, cover, review) and any whose item is not in the approved blueprint go under
 * "Course", last.
 */
export const groupJobsBySection = (
  jobs: CourseCopilotJob[],
  blueprint: CourseBlueprint | null,
  courseLabel: string,
): JobGroup[] => {
  const sections = asArray<CourseBlueprint["sections"][number]>(blueprint?.sections);
  const sectionByItem = new Map<string, number>();
  sections.forEach((section, index) => {
    asArray<{ id: string }>(section?.items).forEach(item => sectionByItem.set(item.id, index));
  });

  const bySection = new Map<number, CourseCopilotJob[]>();
  const course: CourseCopilotJob[] = [];
  for (const job of jobs) {
    const index = job.blueprintItemId ? sectionByItem.get(job.blueprintItemId) : undefined;
    if (index === undefined) {
      course.push(job);
    } else {
      bySection.set(index, [...(bySection.get(index) ?? []), job]);
    }
  }

  const groups: JobGroup[] = [];
  sections.forEach((section, index) => {
    const sectionJobs = bySection.get(index);
    if (sectionJobs?.length) {
      groups.push({
        key: `section-${section.id ?? index}`,
        title:
          asAgentText(section.title) || en.courseCopilotPane.blueprint.untitledSection(index + 1),
        jobs: sectionJobs,
      });
    }
  });
  if (course.length > 0) groups.push({ key: "course", title: courseLabel, jobs: course });
  return groups;
};

const STATUS_ICON_CLASS: Record<CourseCopilotJobStatus, string> = {
  queued: "text-typography-700",
  running: "text-primary-500 motion-safe:animate-spin",
  done: "text-success-500",
  failed: "text-destructive-500",
  skipped: "text-typography-700",
  held: "text-warning-500",
};

const StatusIcon: React.FC<{ status: CourseCopilotJobStatus }> = ({ status }) => {
  const className = `h-4 w-4 shrink-0 ${STATUS_ICON_CLASS[status] ?? ""}`;
  switch (status) {
    case "running":
      return <Refresh className={className} />;
    case "done":
      return <Tick className={className} />;
    case "failed":
      return <FailIcon className={className} />;
    case "skipped":
      return <Minus className={className} />;
    case "held":
      return <PauseIcon className={className} />;
    default:
      return <Timer className={className} />;
  }
};

/**
 * The build as it runs: how far along, how long, how much, and every job's state with
 * the one action that fixes a failed one next to it. The outline the build is writing
 * fills in below, so the trainer watches the course appear rather than a list of verbs.
 *
 * Per Stacks, "Managing User Expectations in Asynchronous Agent Design" and "Status
 * Communication in Asynchronous Agent Design": show what the agent is doing, what stage
 * it is at, and how long it has been going. An estimated finish time is deliberately NOT
 * shown — jobs run four at a time with very different durations, and a guessed ETA that
 * keeps moving is worse than none; progress and elapsed time are what we can state.
 */
export const BuildPanel: React.FC<BuildPanelProps> = ({
  detail,
  flashItemIds,
  onRetryJobs,
  onCancelBuild,
  onRaiseBudget,
  onOpenEditor,
  openEditorDisabledReason,
}) => {
  const strings = en.courseCopilotPane.build;
  const status = detail.session.status;
  const budget = detail.budget;
  const jobs = useMemo(() => asArray<CourseCopilotJob>(detail.jobs), [detail.jobs]);

  const [showRaise, setShowRaise] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [retryingAll, setRetryingAll] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<CourseCopilotJobStatus, number> = {
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      held: 0,
    };
    for (const job of jobs) tally[job.status] = (tally[job.status] ?? 0) + 1;
    return tally;
  }, [jobs]);

  const isBuilding = status === "BUILDING";
  const hasLiveJobs = jobs.some(job => LIVE_JOB_STATUSES.includes(job.status));
  const now = useNow(isBuilding && hasLiveJobs);

  const total = jobs.length;
  const retryable = counts.failed + counts.skipped;
  const percentDone = total > 0 ? Math.round((counts.done / total) * 100) : 0;

  // Elapsed runs from the first job starting to now while jobs are live, and to the last
  // one finishing once they have all settled.
  const firstStart = jobs.reduce<number | null>((earliest, job) => {
    const started = toMs(job.startedAt);
    return started !== null && (earliest === null || started < earliest) ? started : earliest;
  }, null);
  const lastFinish = jobs.reduce<number | null>((latest, job) => {
    const finished = toMs(job.finishedAt);
    return finished !== null && (latest === null || finished > latest) ? finished : latest;
  }, null);
  const elapsedMs =
    firstStart === null ? null : (hasLiveJobs ? now : (lastFinish ?? now)) - firstStart;

  const ceiling = budget.ceilingUsd;
  const spentPercent =
    ceiling > 0 ? Math.min(100, Math.round((budget.spentUsd / ceiling) * 100)) : 0;
  const meterColor = budget.held
    ? "bg-destructive-500"
    : spentPercent >= 80
      ? "bg-warning-300"
      : "bg-primary-500";

  const groups = useMemo(
    () => groupJobsBySection(jobs, detail.session.approvedBlueprint, strings.groupCourse),
    [jobs, detail.session.approvedBlueprint, strings.groupCourse],
  );

  const retryJob = async (jobId: string) => {
    setRetrying(current => new Set(current).add(jobId));
    try {
      await onRetryJobs([jobId]);
    } finally {
      setRetrying(current => {
        const next = new Set(current);
        next.delete(jobId);
        return next;
      });
    }
  };

  const retryAll = async () => {
    setRetryingAll(true);
    try {
      await onRetryJobs();
    } finally {
      setRetryingAll(false);
    }
  };

  const confirmCancel = async () => {
    setIsCancelling(true);
    try {
      await onCancelBuild();
    } finally {
      setIsCancelling(false);
      setShowCancel(false);
    }
  };

  return (
    <div className="space-y-4 px-4 py-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-typography-900">
            {isBuilding || status === "BUILD_FAILED" ? strings.heading : strings.headingFinished}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {retryable > 0 && (
              <Button
                kind="tertiary"
                size="sm"
                disabled={retryingAll}
                onClick={() => void retryAll()}
              >
                {counts.failed > 0 ? strings.retryAll : strings.retrySkipped}
              </Button>
            )}
            {isBuilding && (
              <Button
                kind="danger--tertiary"
                size="sm"
                disabled={isCancelling}
                onClick={() => setShowCancel(true)}
              >
                {strings.cancel}
              </Button>
            )}
          </div>
        </div>

        {total > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              <span className="font-medium text-typography-900">
                {strings.progress(counts.done, total)}
              </span>
              <span className="text-xs text-typography-700">
                {elapsedMs === null
                  ? strings.notStarted
                  : strings.elapsed(formatElapsed(elapsedMs))}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={strings.progressLabel}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={counts.done}
              className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
            >
              <div className="h-full bg-primary-500" style={{ width: `${percentDone}%` }} />
            </div>
            {(counts.failed > 0 || counts.skipped > 0 || counts.held > 0) && (
              <p className="text-xs text-typography-700">
                {[
                  counts.failed > 0 ? strings.failedCount(counts.failed) : null,
                  counts.skipped > 0 ? strings.skippedCount(counts.skipped) : null,
                  counts.held > 0 ? strings.pausedCount(counts.held) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
            <span className="text-xs text-typography-700">{strings.spendLabel}</span>
            <span className="font-medium text-typography-900">
              {ceiling > 0
                ? strings.spentOfCeiling(formatUsd(budget.spentUsd), formatUsd(ceiling))
                : strings.spentNoCeiling(formatUsd(budget.spentUsd))}
            </span>
          </div>
          {ceiling > 0 && (
            <div
              role="meter"
              aria-label={strings.spendLabel}
              aria-valuemin={0}
              aria-valuemax={ceiling}
              aria-valuenow={Math.min(budget.spentUsd, ceiling)}
              className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
            >
              <div className={`h-full ${meterColor}`} style={{ width: `${spentPercent}%` }} />
            </div>
          )}
        </div>
      </header>

      {/* ActionableNotification, not InlineNotification with a Button inside: Carbon throws on
          an interactive child of InlineNotification (Builder's budget banner hit exactly that).
          The text is the product's decided copy, verbatim. */}
      {status === "BUILD_FAILED" && (
        <ActionableNotification
          inline
          kind="error"
          lowContrast
          hideCloseButton
          // Carbon focuses an actionable notification on mount by default; a banner that
          // appears while the trainer is typing in the chat must not take their cursor.
          hasFocus={false}
          role="status"
          subtitle={strings.failedBanner.body}
          actionButtonLabel={strings.failedBanner.retry}
          onActionButtonClick={() => void retryAll()}
        />
      )}

      {budget.held && status !== "BUILD_FAILED" && (
        <ActionableNotification
          inline
          kind="warning"
          lowContrast
          hideCloseButton
          hasFocus={false}
          role="status"
          subtitle={strings.heldBanner.body(formatUsd(budget.spentUsd), formatUsd(ceiling))}
          actionButtonLabel={strings.heldBanner.raise}
          onActionButtonClick={() => setShowRaise(true)}
        />
      )}

      {total === 0 ? (
        <p className="text-sm text-typography-700">{strings.noJobs}</p>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <section key={group.key} aria-label={group.title}>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-typography-700">
                {group.title}
              </h3>
              <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
                {group.jobs.map(job => {
                  const started = toMs(job.startedAt);
                  const finished = toMs(job.finishedAt);
                  const duration =
                    started === null
                      ? null
                      : job.status === "running"
                        ? now - started
                        : finished !== null
                          ? finished - started
                          : null;
                  const detailLine =
                    job.status === "failed"
                      ? asAgentText(job.error)
                      : job.status === "skipped"
                        ? asAgentText(job.skippedReason)
                        : job.status === "done"
                          ? asAgentText(job.summary)
                          : "";
                  const title = asAgentText(job.title) || (strings.kinds[job.kind] ?? job.kind);
                  const isRoleplay = job.kind === "roleplay_new" || job.kind === "roleplay_ref";
                  const canRetry = job.status === "failed" || job.status === "skipped";

                  return (
                    <li
                      key={job.id}
                      data-job-id={job.id}
                      data-status={job.status}
                      className={`flex items-start gap-3 px-3 py-2 ${
                        job.status === "failed" ? "bg-destructive-50/50" : ""
                      }`}
                    >
                      <span className="mt-0.5">
                        <StatusIcon status={job.status} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span
                            className="min-w-0 truncate text-sm font-medium text-typography-900"
                            title={title}
                          >
                            {title}
                          </span>
                          <span className="shrink-0 text-xs text-typography-700">
                            {strings.kinds[job.kind] ?? job.kind}
                          </span>
                        </div>
                        <p className="text-xs text-typography-700">
                          <span
                            className={
                              job.status === "failed"
                                ? "font-medium text-destructive-600"
                                : job.status === "held"
                                  ? "font-medium text-warning-text"
                                  : undefined
                            }
                          >
                            {strings.status[job.status] ?? job.status}
                          </span>
                          {duration !== null && ` · ${formatElapsed(duration)}`}
                          {job.attempts > 1 && ` · ${strings.attempts(job.attempts)}`}
                          {job.costUsd !== null &&
                            job.costUsd > 0 &&
                            ` · ${formatUsd(job.costUsd)}`}
                        </p>
                        {detailLine && (
                          <p
                            className={`mt-0.5 line-clamp-2 text-xs ${
                              job.status === "failed"
                                ? "text-destructive-600"
                                : "text-typography-800"
                            }`}
                            title={detailLine}
                          >
                            {detailLine}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isRoleplay && job.scenarioId !== null && job.scenarioId !== undefined && (
                          // A new tab: the trainer keeps the copilot session where it is.
                          <a
                            href={ROUTES.EDIT_SIMULATION(job.scenarioId)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
                          >
                            {strings.openRoleplay}
                            <Launch className="h-3 w-3" />
                          </a>
                        )}
                        {canRetry && (
                          <Button
                            kind="tertiary"
                            size="sm"
                            disabled={retrying.has(job.id) || retryingAll}
                            onClick={() => void retryJob(job.id)}
                          >
                            {strings.retry}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section aria-label={strings.outlineHeading} className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-typography-700">
          {strings.outlineHeading}
        </h3>
        <CourseOutlinePanel
          compact
          outline={detail.outline}
          flashItemIds={flashItemIds}
          onOpenEditor={onOpenEditor}
          openEditorDisabledReason={openEditorDisabledReason}
        />
      </section>

      <RaiseCeilingDialog
        isOpen={showRaise}
        onClose={() => setShowRaise(false)}
        spentUsd={budget.spentUsd}
        ceilingUsd={ceiling}
        held={budget.held}
        onRaise={onRaiseBudget}
      />

      <ActionConfirmationPopup
        isOpen={showCancel}
        onClose={() => setShowCancel(false)}
        title={strings.cancelConfirm.title}
        description={strings.cancelConfirm.body}
        primaryButton={{
          label: strings.cancelConfirm.confirm,
          onClick: () => void confirmCancel(),
          disabled: isCancelling,
        }}
        secondaryButton={{
          label: strings.cancelConfirm.keep,
          onClick: () => setShowCancel(false),
          disabled: isCancelling,
        }}
      />
    </div>
  );
};
