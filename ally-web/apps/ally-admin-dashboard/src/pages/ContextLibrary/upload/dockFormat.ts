import { en } from "@constants";
import {
  ContextQueueItem,
  ContextSourceStatus,
  ContextUploadOutcome,
  ContextUploadResult,
} from "@types";

import { formatCost, ordinal } from "../contextLibraryFormat";

/**
 * The upload dock's model and the pure mapping from (row, queue) to what the row says.
 *
 * A row follows one document: its bytes going up (`uploading`), the server reading it in
 * memory (`reading`), then the extraction queue (`queued`) until it leaves the queue
 * (`finished`). A file the server would not queue becomes an `exception` row with its default
 * already applied (skipped, mostly) and buttons to choose otherwise.
 */

export type DockPhase = "uploading" | "reading" | "queued" | "finished" | "exception" | "error";

export interface DockFinal {
  status: ContextSourceStatus;
  /** Entries added across the document's collections, by collection. */
  addedByCollection: Record<string, number>;
  error?: string | null;
}

export interface DockRow {
  id: string;
  batchId: string;
  fileName: string;
  title: string;
  collections: string[];
  phase: DockPhase;
  /** 0–1 while uploading. */
  uploadFraction: number;
  outcome?: ContextUploadOutcome;
  message?: string;
  sourceId?: string;
  estimatedStartAt?: string;
  outlivesTtl?: boolean;
  /** When the server queued it. A queue snapshot requested before this can't speak for it. */
  queuedAt?: number;
  /** Inside the cancel's undo window; the cancel is sent when it closes. */
  cancelling?: boolean;
  final?: DockFinal;
}

export type DockAction =
  | "pause"
  | "resume"
  | "cancel"
  | "undoCancel"
  | "front"
  | "retry"
  | "continue"
  | "stop"
  | "skip"
  | "reextract"
  | "addAnyway"
  | "remove"
  | "retryUpload"
  | "dismiss";

export type DockTone = "active" | "idle" | "done" | "warning" | "error";

export interface DockStage {
  label: string;
  /** 0–1, or null when there is no bar to show. */
  progress: number | null;
  tone: DockTone;
  actions: DockAction[];
  /** A second line, e.g. the 24-hour warning. */
  note?: string;
}

/** Nouns per collection id, for "23 principles added". */
export type NounLookup = (collectionId: string) => { noun: string; nounPlural: string };

/** What an upload outcome the server did not queue turns into: its words and its choices. */
export const outcomeStage = (outcome: ContextUploadOutcome, message?: string): DockStage => {
  const strings = en.contextLibrary.dock;
  const label = strings.outcomes[outcome] ?? strings.outcomes.failed;
  switch (outcome) {
    case "already_in_collection":
      return { label, progress: null, tone: "idle", actions: ["skip", "reextract"] };
    case "same_title":
      return { label, progress: null, tone: "idle", actions: ["skip", "addAnyway"] };
    case "no_text":
      return { label, progress: null, tone: "warning", actions: ["remove"] };
    case "failed":
      return {
        label: message ? `${label}: ${message}` : label,
        progress: null,
        tone: "error",
        actions: ["retryUpload", "dismiss"],
      };
    case "duplicate_in_drop":
    case "unsupported":
    case "too_large":
    default:
      return { label, progress: null, tone: "idle", actions: ["dismiss"] };
  }
};

/** A queued upload result becomes a row that follows the queue; anything else an exception. */
export const phaseForResult = (result: ContextUploadResult): DockPhase =>
  result.outcome === "queued" ? "queued" : "exception";

const isWaiting = (item: ContextQueueItem) => item.status === "queued";

/** 1-based place among documents still waiting, in queue order. */
export const placeInLine = (queue: ContextQueueItem[], sourceId: string): number => {
  let place = 0;
  for (const item of queue) {
    if (isWaiting(item)) place += 1;
    if (item.id === sourceId) return place;
  }
  return 0;
};

const fraction = (done: number, total: number): number | null =>
  total > 0 ? Math.min(1, Math.max(0, done / total)) : null;

const addedLabel = (final: DockFinal, nouns: NounLookup, collections: string[]): string => {
  const strings = en.contextLibrary.dock.stages;
  const ids = collections.length ? collections : Object.keys(final.addedByCollection);
  const parts = ids.map(id => {
    const { noun, nounPlural } = nouns(id);
    return strings.added(final.addedByCollection[id] ?? 0, noun, nounPlural);
  });
  return parts.join(" · ");
};

/**
 * The stage a row is at, as a plain label, one progress value and the actions that make sense
 * right now. `queue` is the latest `GET queue`; a queued row missing from it has left the
 * queue, and its `final` (from `GET sources/:id`) says how.
 */
export const dockStage = (
  row: DockRow,
  queue: ContextQueueItem[],
  nouns: NounLookup,
): DockStage => {
  const strings = en.contextLibrary.dock.stages;
  if (row.cancelling) {
    return { label: strings.cancelling, progress: null, tone: "idle", actions: ["undoCancel"] };
  }
  switch (row.phase) {
    case "uploading":
      return {
        label: strings.uploading,
        progress: row.uploadFraction,
        tone: "active",
        actions: [],
      };
    case "reading":
      return { label: strings.reading, progress: 1, tone: "active", actions: [] };
    case "error":
      return {
        label: row.message ? `${strings.uploadFailed}: ${row.message}` : strings.uploadFailed,
        progress: null,
        tone: "error",
        actions: ["retryUpload", "dismiss"],
      };
    case "exception":
      return outcomeStage(row.outcome ?? "failed", row.message);
    case "finished": {
      const final = row.final;
      if (!final || final.status === "complete") {
        return {
          label: final ? addedLabel(final, nouns, row.collections) : strings.finishing,
          progress: 1,
          tone: "done",
          actions: ["dismiss"],
        };
      }
      if (final.status === "cancelled") {
        return { label: strings.cancelled, progress: null, tone: "idle", actions: ["dismiss"] };
      }
      return {
        label: final.error ? `${strings.failed}: ${final.error}` : strings.failed,
        progress: null,
        tone: "error",
        actions: ["retry", "dismiss"],
      };
    }
    case "queued":
    default:
      break;
  }

  const note = row.outlivesTtl ? strings.outlivesTtl : undefined;
  const item = row.sourceId ? queue.find(q => q.id === row.sourceId) : undefined;
  if (!item) {
    return { label: strings.waiting, progress: 0, tone: "idle", actions: ["cancel"], note };
  }
  const progress = fraction(item.partsDone, item.partsTotal);
  const failed: DockAction[] = item.partsFailed > 0 ? ["retry"] : [];
  const failedNote = item.partsFailed > 0 ? strings.partsFailed(item.partsFailed) : undefined;
  switch (item.status) {
    case "queued": {
      const place = placeInLine(queue, item.id);
      return {
        label: place ? strings.waitingInLine(ordinal(place)) : strings.waiting,
        progress,
        tone: "idle",
        actions: ["pause", "cancel", ...(place > 1 ? (["front"] as DockAction[]) : [])],
        note,
      };
    }
    case "extracting":
      return {
        label: strings.extracting(item.partsDone, item.partsTotal),
        progress,
        tone: item.partsFailed > 0 ? "warning" : "active",
        actions: ["pause", "cancel", ...failed],
        note: failedNote ?? note,
      };
    case "consolidating":
      return { label: strings.finishing, progress: 1, tone: "active", actions: [] };
    case "paused":
      if (item.error === "cost_cap") {
        return {
          label: strings.costCap(formatCost(item.costUsd), formatCost(item.costCapUsd)),
          progress,
          tone: "warning",
          actions: ["continue", "stop"],
        };
      }
      return {
        label: strings.paused,
        progress,
        tone: "idle",
        actions: ["resume", "cancel", ...failed],
        note: failedNote,
      };
    default:
      return { label: strings.finishing, progress, tone: "active", actions: [] };
  }
};

/** Rows that are documents being added (not files the server turned away). */
const isDocumentRow = (row: DockRow) =>
  row.phase !== "exception" && row.phase !== "error" && row.final?.status !== "cancelled";

export const isInFlight = (row: DockRow) => row.phase === "uploading" || row.phase === "reading";
export const isActive = (row: DockRow) => isInFlight(row) || row.phase === "queued";

/** Seconds per part × collection, end to end, and the worker's concurrency (ally-be). */
export const SECONDS_PER_PART = 45;
export const WORKER_CONCURRENCY = 3;

export interface DockSummary {
  /** "Adding 12 documents · about 4 min left" or "Added 12 documents". */
  headline: string;
  done: number;
  total: number;
  /** Bytes still going up or being read: leaving the tab would lose them. */
  inFlight: boolean;
  /** Anything still to be extracted: poll the queue. */
  active: boolean;
  /** Every upload reached the server and nothing is in flight. */
  safeToClose: boolean;
  /** "(5/12) Context Library", while anything is active. */
  tabTitle: string | null;
}

export const dockSummary = (rows: DockRow[], queue: ContextQueueItem[]): DockSummary => {
  const strings = en.contextLibrary.dock;
  const documents = rows.filter(isDocumentRow);
  const total = documents.length;
  const done = documents.filter(row => row.phase === "finished").length;
  const inFlight = rows.some(isInFlight);
  const active = rows.some(isActive);
  const remainingParts = documents
    .filter(row => row.phase === "queued" && row.sourceId)
    .map(row => queue.find(q => q.id === row.sourceId))
    .reduce((sum, item) => sum + (item ? Math.max(0, item.partsTotal - item.partsDone) : 0), 0);
  const minutes = Math.ceil((remainingParts * SECONDS_PER_PART) / WORKER_CONCURRENCY / 60);
  const headline = active
    ? [strings.adding(total), remainingParts > 0 ? strings.timeLeft(minutes) : null]
        .filter(Boolean)
        .join(" · ")
    : strings.added(done);
  return {
    headline,
    done,
    total,
    inFlight,
    active,
    safeToClose: total > 0 && !inFlight,
    tabTitle: active && total > 0 ? strings.tabTitle(done, total) : null,
  };
};
