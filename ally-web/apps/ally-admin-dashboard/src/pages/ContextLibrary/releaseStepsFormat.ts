import { en } from "@constants";
import type { ContextRolloutStep } from "@types";

/**
 * Plain words for the release steps (Settings → Release steps). Pure, so they are tested
 * without rendering. Counts come from the step's `detail`, which holds counts only.
 */

const count = (detail: Record<string, number>, key: string): number | undefined =>
  typeof detail[key] === "number" ? detail[key] : undefined;

/** What the step is doing, in a phrase: "Waiting 24 h before removing the old corpus". */
export const releaseStepLabel = (step: ContextRolloutStep, retireAfterHours: number): string => {
  const strings = en.contextLibrary.releaseSteps;
  const detail = step.detail ?? {};
  if (step.step === "retire") {
    if (step.status === "done" && count(detail, "alreadyRetired")) return strings.removedByHand;
    if (step.status === "pending") {
      if (step.waitingUntil) return strings.waitingGrace(retireAfterHours);
      const importable = count(detail, "importable");
      const complete = count(detail, "complete");
      if (importable !== undefined && complete !== undefined && complete < importable) {
        return strings.waitingImport;
      }
      if (count(detail, "activeChunks") === 0) return strings.waitingEntries;
    }
  }
  return strings.steps[step.step]?.[step.status] ?? step.step;
};

/** The step's counts, as one line; empty when it has none worth showing. */
export const releaseStepCounts = (step: ContextRolloutStep): string => {
  const c = en.contextLibrary.releaseSteps.counts;
  const detail = step.detail ?? {};
  const get = (key: string) => count(detail, key);
  const parts: string[] = [];
  switch (step.step) {
    case "import": {
      const importable = get("importable");
      if (importable !== undefined) parts.push(c.imported(get("complete") ?? 0, importable));
      if (get("withFailedParts")) parts.push(c.failedParts(get("withFailedParts")!));
      break;
    }
    case "enrich": {
      const pending = get("pending");
      if (pending) parts.push(c.enrichPending(pending));
      else if (get("passagesCopied") !== undefined) parts.push(c.passages(get("passagesCopied")!));
      break;
    }
    case "smoke_check": {
      const replayed = get("replayed");
      if (replayed === undefined) break;
      parts.push(c.replayed(get("answered") ?? 0, replayed));
      if (get("inGaps")) parts.push(c.gaps(get("inGaps")!, get("gapTopics") ?? 0));
      if (get("failed")) parts.push(c.replayFailed(get("failed")!));
      break;
    }
    case "retire": {
      if (get("documentsDeleted") !== undefined) {
        parts.push(
          c.removed(
            get("documentsDeleted") ?? 0,
            get("passagesDeleted") ?? 0,
            get("filesDeleted") ?? 0,
            get("retrievalLogsDeleted") ?? 0,
          ),
        );
        if (step.status !== "done" && get("filesFailed"))
          parts.push(c.filesKept(get("filesFailed")!));
      } else if (step.status === "pending" && get("activeChunks") !== undefined) {
        parts.push(c.activeEntries(get("activeChunks")!));
      }
      break;
    }
  }
  return parts.join(" · ");
};

/** "10 Nov, 14:05". */
export const formatMoment = (iso?: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
};

/** When it happened, or when it next will. */
export const releaseStepWhen = (step: ContextRolloutStep, maxAttempts: number): string => {
  const when = en.contextLibrary.releaseSteps.when;
  if (step.status === "failed") {
    if (step.nextAttemptAt) return when.retry(formatMoment(step.nextAttemptAt));
    if (step.attempts >= maxAttempts) return when.gaveUp(step.attempts);
  }
  if (step.waitingUntil && step.status === "pending")
    return when.due(formatMoment(step.waitingUntil));
  if (step.finishedAt && (step.status === "done" || step.status === "skipped")) {
    return when.finished(formatMoment(step.finishedAt));
  }
  if (step.startedAt) return when.started(formatMoment(step.startedAt));
  return "";
};
