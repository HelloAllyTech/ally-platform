import React, { useCallback, useEffect, useRef, useState } from "react";

import { Link } from "react-router-dom";
import { toast } from "sonner";

import { useContextChunkActionMutation, useGetContextChunkQuery } from "@api";
import { en } from "@constants";
import { ContextChunkDetail, ContextCollection, ContextChunkSourceLink } from "@types";

import { errorReason, humanise, nounsFor, studioHref } from "./contextLibraryFormat";
import { useContextLibraryScope } from "./contextLibraryScope";
import {
  AudienceBadge,
  ChunkStatusWords,
  InlineError,
  LoadingRows,
  OriginBadge,
} from "./ContextLibraryUi";
import { EntryForm } from "./EntryForm";
import { Sheet } from "../Builder/room/Sheet";

/** Undo stays offered this long after an action. */
export const UNDO_MS = 6_000;

interface ChunkSheetProps {
  code: string;
  collections: ContextCollection[];
  canEdit: boolean;
  onClose: () => void;
}

type ChunkAction = "archive" | "restore" | "pin" | "unpin";
const INVERSE: Record<ChunkAction, ChunkAction> = {
  archive: "restore",
  restore: "archive",
  pin: "unpin",
  unpin: "pin",
};

const formatAttribute = (value: unknown): React.ReactNode => {
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-0.5 pl-5">
        {value.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value);
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(text) ? humanise(text) : text;
};

const sourceLine = (source: ContextChunkSourceLink): string => {
  const pages = en.contextLibrary.sheet.pages(source.pageFrom, source.pageTo);
  const head = [source.title, source.docVersion, source.year].filter(Boolean).join(", ");
  return [head, source.sectionPath, pages].filter(Boolean).join(" · ");
};

/**
 * One entry, in the side sheet (`?chunk=CODE`). Sections come from the collection's profile;
 * a written or imported entry's text is shown verbatim with its citation. Pin, archive and
 * their opposites happen at once with an undo, never behind a confirm.
 */
export const ChunkSheet: React.FC<ChunkSheetProps> = ({
  code,
  collections,
  canEdit: canEditLibrary,
  onClose,
}) => {
  const strings = en.contextLibrary.sheet;
  const { tenantId, orgNames } = useContextLibraryScope();
  const { data, isLoading, isError, error, refetch } = useGetContextChunkQuery({ code, tenantId });
  const [act] = useContextChunkActionMutation();
  const [editing, setEditing] = useState(false);
  // What the last action changed, shown before the server confirms it.
  const [optimistic, setOptimistic] = useState<
    Partial<Pick<ContextChunkDetail, "status" | "pinned">>
  >({});
  // Fresh data from the server replaces the guess (kept as-is when there is none to drop).
  useEffect(
    () => setOptimistic(previous => (Object.keys(previous).length ? {} : previous)),
    [data],
  );

  const collection = collections.find(c => c.id === data?.collectionId);
  const { noun } = nounsFor(collection);
  const chunk = data ? { ...data, ...optimistic } : undefined;
  // An organisation's admin edits their own entries only; Ally's global ones are read-only.
  const notOurs = Boolean(tenantId && data && data.ownerTenantId !== tenantId);
  const canEdit = canEditLibrary && !notOurs;

  // The toast's Undo outlives this render; it calls whatever `run` is current.
  const runRef = useRef<(action: ChunkAction, undoable: boolean) => Promise<void>>();
  const run = useCallback(
    async (action: ChunkAction, undoable: boolean) => {
      const patch =
        action === "archive"
          ? { status: "archived" as const }
          : action === "restore"
            ? { status: "active" as const }
            : { pinned: action === "pin" };
      setOptimistic(previous => ({ ...previous, ...patch }));
      try {
        await act({ code, action, tenantId }).unwrap();
        const message = {
          archive: strings.toasts.archived,
          restore: strings.toasts.restored,
          pin: strings.toasts.pinned,
          unpin: strings.toasts.unpinned,
        }[action](code);
        if (undoable) {
          toast(message, {
            duration: UNDO_MS,
            action: {
              label: strings.toasts.undo,
              onClick: () => void runRef.current?.(INVERSE[action], false),
            },
          });
        } else {
          toast(strings.toasts.undone);
        }
      } catch {
        setOptimistic({});
        toast.error(strings.toasts.failed);
      }
    },
    [act, code, tenantId, strings.toasts],
  );
  runRef.current = run;

  const title = chunk ? `${chunk.code}` : code;
  const synced = chunk?.origin === "synced";
  const studio = synced ? studioHref(chunk?.syncKey) : null;
  const showsText = chunk && (chunk.origin === "authored" || chunk.origin === "imported");
  // A synced item's Studio row decides its text and whether it is live, so there is no Edit,
  // Archive or Restore here — only a way to the row (PLAN.md §10.4).
  const studioLink = studio ? (
    <Link
      to={studio}
      aria-label={strings.openInStudioLabel(chunk?.code ?? code)}
      data-testid="cl-open-in-studio"
      className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 max-md:min-h-10"
    >
      {strings.openInStudio}
      <span aria-hidden>→</span>
    </Link>
  ) : null;

  const footer =
    chunk && canEdit && !editing ? (
      <>
        {!synced && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded px-3 py-2 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            {strings.edit}
          </button>
        )}
        <button
          type="button"
          title={strings.pinHelp}
          onClick={() => void run(chunk.pinned ? "unpin" : "pin", true)}
          className="rounded px-3 py-2 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          {chunk.pinned ? strings.unpin : strings.pin}
        </button>
        {synced ? (
          studioLink
        ) : chunk.status === "archived" ? (
          <button
            type="button"
            onClick={() => void run("restore", true)}
            className="rounded px-3 py-2 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            {strings.restore}
          </button>
        ) : chunk.status === "active" ? (
          <button
            type="button"
            onClick={() => void run("archive", true)}
            className="rounded px-3 py-2 text-sm text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            {strings.archive}
          </button>
        ) : null}
      </>
    ) : undefined;

  return (
    <Sheet title={title} placement="side" onClose={onClose} footer={footer}>
      {isLoading ? (
        <LoadingRows rows={3} />
      ) : isError || !chunk ? (
        (error as { status?: number } | undefined)?.status === 404 ? (
          <p className="text-sm text-typography-600">{strings.notFound}</p>
        ) : (
          <InlineError what={code} reason={errorReason(error)} onRetry={() => void refetch()} />
        )
      ) : editing && collection ? (
        <EntryForm
          collection={collection}
          initial={chunk}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="space-y-6" data-testid="cl-chunk-sheet">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs text-typography-600">{chunk.code}</span>
            <OriginBadge origin={chunk.origin} />
            <AudienceBadge chunk={chunk} ownTenantId={tenantId} orgNames={orgNames} />
            <ChunkStatusWords chunk={chunk} noun={noun} />
          </div>
          <p className="text-lg font-medium leading-snug text-typography-900">{chunk.statement}</p>

          {collection &&
            Object.entries(collection.attributes)
              .filter(
                ([key, spec]) => spec.shown !== false && chunk.attributes?.[key] !== undefined,
              )
              .filter(([key]) => chunk.attributes[key] !== "" && chunk.attributes[key] !== null)
              .map(([key, spec]) => (
                <section key={key}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
                    {spec.label}
                  </h3>
                  <div className="text-sm text-typography-900">
                    {formatAttribute(chunk.attributes[key])}
                  </div>
                </section>
              ))}

          {collection && Object.keys(collection.facets).some(key => chunk.facets?.[key]) && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              {Object.entries(collection.facets)
                .filter(([key]) => chunk.facets?.[key])
                .map(([key, spec]) => {
                  const value = chunk.facets[key];
                  const values = Array.isArray(value) ? value : [value];
                  return (
                    <React.Fragment key={key}>
                      <dt className="text-typography-600">{spec.label}</dt>
                      <dd>{values.map(v => humanise(String(v))).join(", ")}</dd>
                    </React.Fragment>
                  );
                })}
            </dl>
          )}

          {showsText && chunk.body && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
                {strings.body}
              </h3>
              <div className="whitespace-pre-wrap rounded border border-border-light bg-neutral-50 p-3 text-sm">
                {chunk.body}
              </div>
              {chunk.citation?.title && (
                <p className="mt-1 text-xs text-typography-600">
                  {strings.citation}:{" "}
                  {sourceLine({
                    title: chunk.citation.title,
                    sectionPath: chunk.citation.sectionPath,
                    pageFrom: chunk.citation.pageFrom,
                    pageTo: chunk.citation.pageTo,
                  })}
                </p>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
              {strings.whereFrom}
            </h3>
            {chunk.sources?.length ? (
              <ul className="space-y-1 text-sm">
                {chunk.sources.map((source, i) => (
                  <li key={`${source.id ?? i}-${i}`}>{sourceLine(source)}</li>
                ))}
              </ul>
            ) : (
              <p
                className="text-sm text-typography-600"
                data-testid={synced ? "cl-synced-note" : undefined}
              >
                {synced ? strings.syncedNote : strings.whereFromNone}
                {synced && studioLink && <> {studioLink}</>}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
              {strings.history}
            </h3>
            <p className="text-sm text-typography-600">{strings.historyPlaceholder}</p>
          </section>

          {notOurs && canEditLibrary && (
            <p className="text-xs text-typography-600" data-testid="cl-global-read-only">
              {en.contextLibrary.org.globalReadOnly}
            </p>
          )}
          {!canEditLibrary && <p className="text-xs text-typography-600">{strings.readOnly}</p>}
        </div>
      )}
    </Sheet>
  );
};
