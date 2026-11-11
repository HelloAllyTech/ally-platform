import { ContextUploadOptions, ContextUploadResult } from "@types";

import { DockRow, phaseForResult } from "./dockFormat";
import { sendUpload, UploadError } from "./uploadClient";

/**
 * The upload dock's state, kept outside React so it outlives the page that started an upload:
 * the dock is mounted in the admin layout and keeps following documents across pages.
 *
 * Read it with `useSyncExternalStore(dockStore.subscribe, dockStore.getSnapshot)`.
 * The `File`s themselves stay in this tab's memory only, so a skipped file can be sent again
 * (Re-extract, Add anyway, Retry) without asking for it twice.
 */

export interface DockState {
  rows: DockRow[];
  collapsed: boolean;
}

/** ally-be CL_UPLOAD_MAX_FILES: more than this in one drop is sent as several requests. */
export const UPLOAD_BATCH_SIZE = 25;

let state: DockState = { rows: [], collapsed: false };
const listeners = new Set<() => void>();
const files = new Map<string, File>();
const cancelTimers = new Map<string, ReturnType<typeof setTimeout>>();

const emit = () => listeners.forEach(listener => listener());

const setState = (next: Partial<DockState>) => {
  state = { ...state, ...next };
  emit();
};

const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
        Math.floor(Math.random() * 16).toString(16),
      );

const titleFromFileName = (name: string) => name.replace(/\.(pdf|epub)$/i, "");

export const dockStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): DockState {
    return state;
  },
};

export const updateRow = (id: string, patch: Partial<DockRow>) =>
  setState({ rows: state.rows.map(row => (row.id === id ? { ...row, ...patch } : row)) });

const updateRows = (ids: Set<string>, patch: Partial<DockRow>) =>
  setState({ rows: state.rows.map(row => (ids.has(row.id) ? { ...row, ...patch } : row)) });

export const removeRow = (id: string) => {
  files.delete(id);
  const timer = cancelTimers.get(id);
  if (timer) clearTimeout(timer);
  cancelTimers.delete(id);
  setState({ rows: state.rows.filter(row => row.id !== id) });
};

export const setCollapsed = (collapsed: boolean) => setState({ collapsed });

/** Drops every row that needs nothing more from anyone. */
export const clearSettled = () => {
  const keep = state.rows.filter(
    row => row.phase === "uploading" || row.phase === "reading" || row.phase === "queued",
  );
  for (const row of state.rows) if (!keep.includes(row)) files.delete(row.id);
  setState({ rows: keep });
};

/** Pairs each result with the row it answers: same file name, first one not yet answered. */
export const matchResults = (
  rows: Array<Pick<DockRow, "id" | "fileName">>,
  results: ContextUploadResult[],
): Map<string, ContextUploadResult> => {
  const matched = new Map<string, ContextUploadResult>();
  for (const result of results) {
    const row = rows.find(r => r.fileName === result.fileName && !matched.has(r.id));
    if (row) matched.set(row.id, result);
  }
  return matched;
};

const applyResults = (rowIds: string[], results: ContextUploadResult[]) => {
  const rows = state.rows.filter(row => rowIds.includes(row.id));
  const matched = matchResults(rows, results);
  const now = Date.now();
  setState({
    rows: state.rows.map(row => {
      if (!rowIds.includes(row.id)) return row;
      const result = matched.get(row.id);
      if (!result) {
        return { ...row, phase: "error", message: "The server didn't say what happened to it." };
      }
      const phase = phaseForResult(result);
      if (phase === "queued") files.delete(row.id);
      return {
        ...row,
        phase,
        outcome: result.outcome,
        message: result.message,
        sourceId: result.sourceId ?? row.sourceId,
        title: result.title || row.title,
        estimatedStartAt: result.estimatedStartAt,
        outlivesTtl: result.outlivesTtl,
        queuedAt: phase === "queued" ? now : undefined,
        uploadFraction: 1,
      };
    }),
  });
};

const sendBatch = (rowIds: string[], batchFiles: File[], options: ContextUploadOptions) => {
  const ids = new Set(rowIds);
  const { promise } = sendUpload(batchFiles, options, {
    onProgress: fraction => updateRows(ids, { uploadFraction: fraction }),
    onSent: () => updateRows(ids, { phase: "reading", uploadFraction: 1 }),
  });
  promise
    .then(results => applyResults(rowIds, results))
    .catch((error: unknown) =>
      updateRows(ids, {
        phase: "error",
        message: error instanceof UploadError ? error.message : String(error),
      }),
    );
};

/**
 * Adds documents: one row each, sent in batches the server accepts. Rows appear at once, so the
 * dock shows the drop landing before the first byte has gone.
 */
export const addDocuments = (incoming: File[], options: ContextUploadOptions): void => {
  if (!incoming.length) return;
  const created: DockRow[] = [];
  for (let i = 0; i < incoming.length; i += UPLOAD_BATCH_SIZE) {
    const batch = incoming.slice(i, i + UPLOAD_BATCH_SIZE);
    const batchId = newId();
    const rows = batch.map(file => {
      const row: DockRow = {
        id: newId(),
        batchId,
        fileName: file.name,
        title: titleFromFileName(file.name),
        collections: options.collections,
        audience: options.audience,
        phase: "uploading",
        uploadFraction: 0,
      };
      files.set(row.id, file);
      return row;
    });
    created.push(...rows);
    // Sent after the rows exist, below.
    queueMicrotask(() =>
      sendBatch(
        rows.map(r => r.id),
        batch,
        { ...options, batchId },
      ),
    );
  }
  setState({ rows: [...state.rows, ...created], collapsed: false });
};

/**
 * Sends one row's file again — Re-extract, Add anyway, or Retry after a failed upload. False
 * when the file is no longer in memory (the tab was reloaded), so the caller can say so.
 */
export const resendRow = (
  id: string,
  extra: Pick<ContextUploadOptions, "reextract" | "addAnyway"> = {},
): boolean => {
  const row = state.rows.find(r => r.id === id);
  const file = files.get(id);
  if (!row || !file) return false;
  updateRow(id, {
    phase: "uploading",
    uploadFraction: 0,
    outcome: undefined,
    message: undefined,
    final: undefined,
  });
  sendBatch([id], [file], {
    collections: row.collections,
    audience: row.audience,
    ...extra,
    batchId: row.batchId,
  });
  return true;
};

/**
 * Cancel with an undo window: the row says "Cancelling…" for `windowMs`, and only then is the
 * cancel sent (it cannot be taken back on the server).
 */
export const scheduleCancel = (id: string, send: () => Promise<unknown>, windowMs = 6_000) => {
  updateRow(id, { cancelling: true });
  const timer = setTimeout(() => {
    cancelTimers.delete(id);
    const row = state.rows.find(r => r.id === id);
    if (!row?.cancelling) return;
    send()
      .then(() =>
        updateRow(id, {
          cancelling: false,
          phase: "finished",
          final: { status: "cancelled", addedByCollection: {} },
        }),
      )
      .catch(() => updateRow(id, { cancelling: false }));
  }, windowMs);
  cancelTimers.set(id, timer);
};

export const undoCancel = (id: string) => {
  const timer = cancelTimers.get(id);
  if (timer) clearTimeout(timer);
  cancelTimers.delete(id);
  updateRow(id, { cancelling: false });
};

/** Test-only: back to an empty dock. */
export const resetDockStore = () => {
  cancelTimers.forEach(timer => clearTimeout(timer));
  cancelTimers.clear();
  files.clear();
  state = { rows: [], collapsed: false };
  emit();
};
