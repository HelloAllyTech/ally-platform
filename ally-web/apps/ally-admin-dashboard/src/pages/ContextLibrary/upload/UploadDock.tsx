import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileSearch,
  Layers,
  PauseCircle,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  useContextSourceActionMutation,
  useGetContextCollectionsQuery,
  useGetContextQueueQuery,
  useLazyGetContextSourceQuery,
  useResumeContextSourceMutation,
} from "@api";
import { en } from "@constants";
import { ContextQueueItem } from "@types";

import { DockAction, DockRow, DockStage, DockTone, dockStage, dockSummary } from "./dockFormat";
import {
  clearSettled,
  dockStore,
  removeRow,
  resendRow,
  scheduleCancel,
  setCollapsed,
  undoCancel,
  updateRow,
} from "./uploadStore";
import { BUILDER_DURATION, BUILDER_EASING, builderTransition } from "../../Builder/builderMotion";

const POLL_MS = 3_000;
/** The live region speaks at most this often, except when a document finishes. */
const ANNOUNCE_EVERY_MS = 15_000;
/** "Continue" past a cost cap raises it by half again, at least a dollar. */
const raiseFor = (cap: number | null) => Math.max(1, Math.round((cap ?? 2) * 50) / 100);

const EMPTY_QUEUE: ContextQueueItem[] = [];

const TONE_CLASS: Record<DockTone, string> = {
  active: "text-primary-600",
  idle: "text-typography-600",
  done: "text-green-700",
  warning: "text-amber-700",
  error: "text-red-700",
};

const STAGE_ICON = (row: DockRow, stage: DockStage) => {
  const props = { size: 14, "aria-hidden": true, className: "shrink-0" } as const;
  if (stage.tone === "error") return <XCircle {...props} />;
  if (stage.tone === "warning") return <AlertTriangle {...props} />;
  if (stage.tone === "done") return <CheckCircle2 {...props} />;
  if (row.phase === "uploading") return <Upload {...props} />;
  if (row.phase === "reading") return <FileSearch {...props} />;
  if (stage.actions.includes("resume")) return <PauseCircle {...props} />;
  if (stage.tone === "active") return <Layers {...props} />;
  return <Clock {...props} />;
};

/**
 * Mounted in the admin layout: draws nothing until a document is added, then follows every
 * document across pages until it is dismissed.
 */
export const UploadDockHost: React.FC = () => {
  const { rows } = useSyncExternalStore(dockStore.subscribe, dockStore.getSnapshot);
  return rows.length ? <UploadDock /> : null;
};

/**
 * The upload dock: bottom-right, collapsible, one row per document with one progress bar and
 * a plain stage label. It polls the queue every 3s while anything is being extracted, warns
 * before the tab closes while bytes are still going up, and says when it is safe to close.
 */
export const UploadDock: React.FC = () => {
  const strings = en.contextLibrary.dock;
  const { rows, collapsed } = useSyncExternalStore(dockStore.subscribe, dockStore.getSnapshot);
  const hasQueued = rows.some(row => row.phase === "queued");

  const queueQuery = useGetContextQueueQuery(undefined, {
    skip: !hasQueued,
    pollingInterval: hasQueued ? POLL_MS : 0,
  });
  const queue = queueQuery.data ?? EMPTY_QUEUE;
  const { data: collections } = useGetContextCollectionsQuery();
  const [fetchSource] = useLazyGetContextSourceQuery();
  const [sourceAction] = useContextSourceActionMutation();
  const [resumeSource] = useResumeContextSourceMutation();

  const nouns = useCallback(
    (id: string) => {
      const c = collections?.find(col => col.id === id);
      return c
        ? { noun: c.noun, nounPlural: c.nounPlural }
        : { noun: en.contextLibrary.allNoun, nounPlural: en.contextLibrary.allNounPlural };
    },
    [collections],
  );
  const collectionName = useCallback(
    (id: string) => collections?.find(col => col.id === id)?.name ?? id,
    [collections],
  );

  const summary = useMemo(() => dockSummary(rows, queue), [rows, queue]);

  /* ── A document leaving the queue: read its report ─────────────────── */

  const resolving = useRef(new Set<string>());
  useEffect(() => {
    const startedAt = queueQuery.startedTimeStamp ?? 0;
    if (!queueQuery.isSuccess || queueQuery.isFetching) return;
    for (const row of rows) {
      if (row.phase !== "queued" || !row.sourceId || row.cancelling) continue;
      if (!row.queuedAt || startedAt <= row.queuedAt) continue;
      if (queue.some(item => item.id === row.sourceId)) continue;
      if (resolving.current.has(row.id)) continue;
      resolving.current.add(row.id);
      const rowId = row.id;
      fetchSource(row.sourceId)
        .unwrap()
        .then(source => {
          if (["queued", "extracting", "consolidating", "paused"].includes(source.status)) return;
          const addedByCollection = Object.fromEntries(
            Object.entries(source.yield ?? {}).map(([id, y]) => [
              id,
              (y.published ?? 0) + (y.publishedLowConfidence ?? 0),
            ]),
          );
          updateRow(rowId, {
            phase: "finished",
            title: source.title || row.title,
            final: { status: source.status, addedByCollection, error: source.error },
          });
        })
        .catch(() => undefined)
        .finally(() => resolving.current.delete(rowId));
    }
  }, [
    fetchSource,
    queue,
    queueQuery.isFetching,
    queueQuery.isSuccess,
    queueQuery.startedTimeStamp,
    rows,
  ]);

  /* ── The tab: its title, and a warning before closing mid-upload ───── */

  useEffect(() => {
    if (!summary.tabTitle) return undefined;
    const previous = document.title;
    document.title = summary.tabTitle;
    return () => {
      document.title = previous;
    };
  }, [summary.tabTitle]);

  useEffect(() => {
    if (!summary.inFlight) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show nothing without a returnValue.
      event.returnValue = strings.leaveWarning;
      return strings.leaveWarning;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [strings.leaveWarning, summary.inFlight]);

  /* ── A polite, throttled live region ───────────────────────────────── */

  const [announcement, setAnnouncement] = useState("");
  const lastAnnounced = useRef({ at: 0, done: -1 });
  useEffect(() => {
    const now = Date.now();
    const finishedOne = summary.done !== lastAnnounced.current.done;
    if (!finishedOne && now - lastAnnounced.current.at < ANNOUNCE_EVERY_MS) return;
    lastAnnounced.current = { at: now, done: summary.done };
    setAnnouncement(
      summary.safeToClose && !summary.active
        ? `${summary.headline}. ${strings.safeToClose}.`
        : summary.headline,
    );
  }, [strings.safeToClose, summary.active, summary.done, summary.headline, summary.safeToClose]);

  /* ── Row actions ────────────────────────────────────────────────────── */

  const runAction = useCallback(
    async (row: DockRow, action: DockAction) => {
      const sourceId = row.sourceId;
      const failed = () => toast.error(strings.actionFailed);
      const send = (promise: Promise<unknown>) => promise.catch(failed);
      switch (action) {
        case "dismiss":
        case "skip":
        case "remove":
          removeRow(row.id);
          return;
        case "undoCancel":
          undoCancel(row.id);
          return;
        case "reextract":
          if (!resendRow(row.id, { reextract: true })) failed();
          return;
        case "addAnyway":
          if (!resendRow(row.id, { addAnyway: true })) failed();
          return;
        case "retryUpload":
          if (!resendRow(row.id)) failed();
          return;
        default:
          break;
      }
      if (!sourceId) return;
      switch (action) {
        case "pause":
          await send(sourceAction({ id: sourceId, action: "pause" }).unwrap());
          return;
        case "resume":
          await send(resumeSource({ id: sourceId }).unwrap());
          return;
        case "continue": {
          const item = queue.find(q => q.id === sourceId);
          await send(
            resumeSource({ id: sourceId, raiseCapBy: raiseFor(item?.costCapUsd ?? null) }).unwrap(),
          );
          return;
        }
        case "front":
          await send(sourceAction({ id: sourceId, action: "front" }).unwrap());
          return;
        case "retry":
          await send(
            sourceAction({ id: sourceId, action: "retry" })
              .unwrap()
              .then(() =>
                updateRow(row.id, { phase: "queued", final: undefined, queuedAt: Date.now() }),
              ),
          );
          return;
        case "cancel":
        case "stop":
          scheduleCancel(row.id, () => sourceAction({ id: sourceId, action: "cancel" }).unwrap());
          return;
        default:
          return;
      }
    },
    [queue, resumeSource, sourceAction, strings.actionFailed],
  );

  const settled = rows.some(
    row => row.phase === "finished" || row.phase === "exception" || row.phase === "error",
  );

  return (
    <section
      aria-label={strings.region}
      className="fixed bottom-4 right-4 z-[55] flex w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-border-light bg-white shadow-lg"
      data-testid="context-upload-dock"
    >
      <style>{DOCK_KEYFRAMES}</style>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div className="flex items-center gap-2 border-b border-border-light px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{summary.headline}</p>
          {summary.safeToClose && (
            <p
              className="cl-safe-to-close flex items-center gap-1 text-xs text-green-700"
              data-testid="dock-safe-to-close"
            >
              <Check size={12} aria-hidden /> {strings.safeToClose}
            </p>
          )}
        </div>
        {settled && !collapsed && (
          <button
            type="button"
            onClick={clearSettled}
            className="rounded px-2 py-1 text-xs text-typography-600 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            {strings.dismissAll}
          </button>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? strings.expand : strings.collapse}
          className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          {collapsed ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </button>
      </div>
      {!collapsed && (
        <ul className="max-h-[50vh] divide-y divide-border-light overflow-y-auto">
          {rows.map(row => (
            <DockRowView
              key={row.id}
              row={row}
              stage={dockStage(row, queue, nouns)}
              collectionName={collectionName}
              onAction={action => void runAction(row, action)}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

/** "Safe to close" is one of the page's two expressive moments; reduced motion keeps it still. */
const DOCK_KEYFRAMES = `
@keyframes cl-safe-in { from { opacity: 0; transform: translateY(4px) scale(0.96); } to { opacity: 1; transform: none; } }
.cl-safe-to-close { animation: cl-safe-in ${BUILDER_DURATION.celebratory}ms ${BUILDER_EASING.expressive} both; }
@media (prefers-reduced-motion: reduce) { .cl-safe-to-close { animation: none; } .cl-dock-bar { transition: none !important; } }
`;

interface DockRowViewProps {
  row: DockRow;
  stage: DockStage;
  collectionName: (id: string) => string;
  onAction: (action: DockAction) => void;
}

const DockRowView: React.FC<DockRowViewProps> = ({ row, stage, collectionName, onAction }) => {
  const strings = en.contextLibrary.dock;
  return (
    <li className="px-3 py-2" data-testid="dock-row">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={row.title}>
          {row.title}
        </p>
      </div>
      {row.collections.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {row.collections.map(id => (
            <span
              key={id}
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-typography-600"
            >
              {collectionName(id)}
            </span>
          ))}
        </div>
      )}
      {stage.progress !== null && (
        <div
          role="progressbar"
          aria-label={row.title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(stage.progress * 100)}
          className="mt-2 h-1 w-full overflow-hidden rounded bg-neutral-100"
        >
          <div
            className={`cl-dock-bar h-full ${stage.tone === "done" ? "bg-green-600" : "bg-primary-500"}`}
            style={{
              width: `${Math.round(stage.progress * 100)}%`,
              transition: builderTransition(["width"], "moderate", "productive"),
            }}
          />
        </div>
      )}
      <p className={`mt-1 flex items-center gap-1 text-xs ${TONE_CLASS[stage.tone]}`}>
        {STAGE_ICON(row, stage)}
        <span>{stage.label}</span>
      </p>
      {stage.note && <p className="mt-0.5 text-xs text-amber-700">{stage.note}</p>}
      {stage.actions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {stage.actions.map(action => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action)}
              aria-label={`${strings.actions[action]}: ${row.title}`}
              className="rounded px-2 py-0.5 text-xs font-medium text-primary-600 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            >
              {strings.actions[action]}
            </button>
          ))}
        </div>
      )}
    </li>
  );
};
