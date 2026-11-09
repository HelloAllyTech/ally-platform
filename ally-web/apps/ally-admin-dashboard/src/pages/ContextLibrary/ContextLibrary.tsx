import React, { useCallback, useMemo, useRef, useState } from "react";

import { BarChart3, Library, Settings2 } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { useGetContextCollectionsQuery, useGetPermissionsQuery } from "@api";
import { Permissions, en } from "@constants";
import { ContextCollection } from "@types";

import {
  AddChoice,
  AddDocumentsChoice,
  AddDocumentsDialog,
  AddMenu,
  DOCUMENT_ACCEPT,
  DropOverlay,
  FirstRunHero,
  defaultTargets,
  rememberTargets,
  useDocumentDrop,
} from "./AddDocuments";
import { BulkUpload } from "./BulkUpload";
import { ChunkSheet } from "./ChunkSheet";
import {
  capitalise,
  errorReason,
  nounsFor,
  splitDocuments,
  takesEntries,
} from "./contextLibraryFormat";
import { InlineError, LoadingRows, Segmented } from "./ContextLibraryUi";
import { DocumentSheet, DocumentsView } from "./DocumentsView";
import { EntryForm } from "./EntryForm";
import { LibraryView } from "./LibraryView";
import { SettingsView } from "./SettingsView";
import { addDocuments } from "./upload/uploadStore";
import { Sheet } from "../Builder/room/Sheet";

export type ContextLibraryView = "library" | "insights" | "settings";
type ListMode = "entries" | "documents";

const VIEWS: ContextLibraryView[] = ["library", "insights", "settings"];
const VIEW_ICON = { library: Library, insights: BarChart3, settings: Settings2 } as const;

export const parseView = (value: string | null): ContextLibraryView =>
  VIEWS.includes(value as ContextLibraryView) ? (value as ContextLibraryView) : "library";

/**
 * The Context Library: Library (default) · Insights · Settings, deep-linked with `?view=`, and
 * a collection switcher remembered in `?collection=`. Every overlay is a URL parameter pushed
 * as a history entry (`?chunk=`, `?document=`, `?sheet=new|bulk`), so Back closes it and a
 * link to one opens it.
 *
 * Documents can be dropped anywhere on the page. The upload dock that follows them lives in
 * the admin layout (`UploadDockHost`), so it keeps going when you leave this page.
 */
export const ContextLibrary: React.FC = () => {
  const strings = en.contextLibrary;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const view = parseView(params.get("view"));
  const collectionId = params.get("collection") || null;
  const listMode: ListMode = params.get("list") === "documents" ? "documents" : "entries";
  const chunkCode = params.get("chunk");
  const documentId = params.get("document");
  const sheet = params.get("sheet");

  const collectionsQuery = useGetContextCollectionsQuery();
  const collections = useMemo(() => collectionsQuery.data ?? [], [collectionsQuery.data]);
  const current: ContextCollection | undefined = collections.find(c => c.id === collectionId);
  const { data: permissions } = useGetPermissionsQuery();
  const canEdit = ((permissions ?? []) as string[]).includes(Permissions.EDIT_CONTEXT_LIBRARY);

  const documentCollections = useMemo(
    () => collections.filter(c => c.takesDocuments),
    [collections],
  );
  const entryCollections = useMemo(() => collections.filter(takesEntries), [collections]);
  const { nounPlural } = nounsFor(current);
  const libraryEmpty = collections.length > 0 && collections.every(c => !(c.counts?.active ?? 0));

  /* ── URL-backed state ─────────────────────────────────────────────── */

  const withChanges = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    },
    [params],
  );

  /** Open an overlay as a history entry, so Back closes it. */
  const pushOverlay = useCallback(
    (changes: Record<string, string | null>) =>
      navigate({ search: withChanges(changes).toString() }, { state: { clOverlay: true } }),
    [navigate, withChanges],
  );

  const closeOverlay = useCallback(
    (key: "chunk" | "document" | "sheet") => {
      // Opened from here: step back, so Back and Close agree. Arrived by link: just drop it.
      if ((location.state as { clOverlay?: boolean } | null)?.clOverlay) navigate(-1);
      else setParams(withChanges({ [key]: null }), { replace: true });
    },
    [location.state, navigate, setParams, withChanges],
  );

  const setView = (next: ContextLibraryView) =>
    setParams(withChanges({ view: next === "library" ? null : next, chunk: null, document: null }));
  const setCollection = (id: string) =>
    setParams(withChanges({ collection: id || null, list: null }));
  const setListMode = (mode: ListMode) =>
    setParams(withChanges({ list: mode === "documents" ? "documents" : null }), { replace: true });

  /* ── Adding documents ─────────────────────────────────────────────── */

  const [staged, setStaged] = useState<File[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startUpload = useCallback((choice: AddDocumentsChoice) => {
    rememberTargets(choice.collections);
    addDocuments(choice.files, {
      collections: choice.collections,
      docVersion: choice.docVersion,
      year: choice.year,
    });
  }, []);

  /**
   * With one collection in view and nothing to skip, a drop goes straight in — the overlay
   * already said where. Otherwise the dialog names what is skipped and asks where to.
   */
  const receiveFiles = useCallback(
    (files: File[]) => {
      const { accepted, skipped } = splitDocuments(files);
      if (current?.takesDocuments && accepted.length && !skipped.length) {
        startUpload({ files: accepted, collections: [current.id] });
        return;
      }
      setStaged(files);
    },
    [current, startUpload],
  );

  const dropEnabled = canEdit && documentCollections.length > 0 && !sheet && !staged;
  const { dragging, dragCount } = useDocumentDrop(dropEnabled, receiveFiles);
  const targets = defaultTargets(documentCollections, collectionId);

  const onAdd = (choice: AddChoice) => {
    if (choice === "upload") fileInputRef.current?.click();
    if (choice === "entry") pushOverlay({ sheet: "new" });
    if (choice === "bulk") pushOverlay({ sheet: "bulk" });
  };

  /* ── Render ───────────────────────────────────────────────────────── */

  const segments: Array<{ id: ListMode; label: string }> = [
    { id: "entries", label: capitalise(nounPlural) },
    ...((current ? current.takesDocuments : documentCollections.length > 0)
      ? [{ id: "documents" as ListMode, label: strings.documents }]
      : []),
  ];

  const renderLibrary = () => {
    if (collectionsQuery.isLoading) return <LoadingRows />;
    if (collectionsQuery.isError) {
      return (
        <InlineError
          what={strings.title}
          reason={errorReason(collectionsQuery.error)}
          onRetry={() => void collectionsQuery.refetch()}
        />
      );
    }
    if (libraryEmpty && listMode === "entries") {
      return (
        <FirstRunHero
          documentCollections={documentCollections}
          initialTargets={targets}
          canEdit={canEdit}
          onFiles={(files, chosen) => {
            const { accepted, skipped } = splitDocuments(files);
            if (skipped.length || !accepted.length) setStaged(files);
            else startUpload({ files: accepted, collections: chosen });
          }}
          onWrite={() => pushOverlay({ sheet: "new" })}
        />
      );
    }
    return (
      <div className="space-y-4">
        {segments.length > 1 && (
          <Segmented
            label={strings.segmentLabel}
            options={segments}
            value={listMode}
            onChange={setListMode}
          />
        )}
        {listMode === "documents" ? (
          <DocumentsView collectionId={current?.id} onOpen={id => pushOverlay({ document: id })} />
        ) : (
          <LibraryView
            key={current?.id ?? "all"}
            collection={current}
            collections={collections}
            onOpenChunk={code => pushOverlay({ chunk: code })}
          />
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="context-library-page">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h1 className="text-2xl font-semibold text-typography-900">{strings.title}</h1>
          <p className="text-sm text-typography-600">{strings.subtitle}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">{strings.switcher.label}</span>
          <select
            value={collectionId ?? ""}
            onChange={event => setCollection(event.target.value)}
            className="h-10 rounded border border-border-light bg-white px-2 text-sm"
            data-testid="cl-collection-switcher"
          >
            <option value="">{strings.switcher.all}</option>
            {collections.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.counts?.active ?? 0})
              </option>
            ))}
          </select>
        </label>
        {canEdit && (
          <div className="ml-auto">
            <AddMenu
              canUpload={current ? current.takesDocuments : documentCollections.length > 0}
              canWrite={current ? takesEntries(current) : entryCollections.length > 0}
              onChoose={onAdd}
            />
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          className="hidden"
          data-testid="cl-file-input"
          onChange={event => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = "";
            // A picker is deliberate, so it always shows where the files will go.
            if (chosen.length) setStaged(chosen);
          }}
        />
      </header>

      <div
        role="tablist"
        aria-label={strings.viewsLabel}
        className="flex gap-1 border-b border-border-light"
      >
        {VIEWS.map(id => {
          const Icon = VIEW_ICON[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`cl-tab-${id}`}
              aria-selected={view === id}
              aria-controls={`cl-panel-${id}`}
              onClick={() => setView(id)}
              className={[
                "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500",
                view === id
                  ? "border-primary-600 font-medium text-typography-900"
                  : "border-transparent text-typography-600 hover:text-typography-900",
              ].join(" ")}
            >
              <Icon size={14} aria-hidden />
              {strings.views[id]}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`cl-panel-${view}`} aria-labelledby={`cl-tab-${view}`}>
        {view === "library" && renderLibrary()}
        {view === "insights" && (
          <p className="py-12 text-center text-sm text-typography-600" data-testid="cl-insights">
            {strings.insights.placeholder}
          </p>
        )}
        {view === "settings" && <SettingsView collections={collections} canEdit={canEdit} />}
      </div>

      {dragging && <DropOverlay count={dragCount} collections={collections} targets={targets} />}

      {staged && (
        <AddDocumentsDialog
          files={staged}
          documentCollections={documentCollections}
          initialTargets={targets}
          onCancel={() => setStaged(null)}
          onConfirm={choice => {
            setStaged(null);
            startUpload(choice);
          }}
        />
      )}

      {chunkCode && (
        <ChunkSheet
          code={chunkCode}
          collections={collections}
          canEdit={canEdit}
          onClose={() => closeOverlay("chunk")}
        />
      )}
      {documentId && (
        <DocumentSheet
          id={documentId}
          collections={collections}
          onClose={() => closeOverlay("document")}
        />
      )}
      {sheet === "new" && canEdit && (
        <NewEntrySheet
          collections={entryCollections}
          current={current}
          onClose={() => closeOverlay("sheet")}
          onSaved={code =>
            navigate(
              { search: withChanges({ sheet: null, chunk: code }).toString() },
              { replace: true, state: location.state },
            )
          }
        />
      )}
      {sheet === "bulk" && canEdit && (
        <BulkUpload
          collections={collections}
          initialCollectionId={current?.id}
          onClose={() => closeOverlay("sheet")}
        />
      )}
    </div>
  );
};

/** New entry: the form for the collection in view, or a choice of collection under All. */
const NewEntrySheet: React.FC<{
  collections: ContextCollection[];
  current?: ContextCollection;
  onClose: () => void;
  onSaved: (code: string) => void;
}> = ({ collections, current, onClose, onSaved }) => {
  const strings = en.contextLibrary.entry;
  const [chosenId, setChosenId] = useState(
    current && takesEntries(current) ? current.id : (collections[0]?.id ?? ""),
  );
  const chosen = collections.find(c => c.id === chosenId);
  return (
    <Sheet
      title={strings.newTitle(chosen?.noun ?? en.contextLibrary.allNoun)}
      placement="side"
      onClose={onClose}
    >
      {current && !takesEntries(current) ? (
        <p className="text-sm text-typography-700">{strings.syncedOnly(current.name)}</p>
      ) : (
        <div className="space-y-5">
          {!current && (
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-typography-700">{strings.collection}</span>
              <select
                value={chosenId}
                onChange={event => setChosenId(event.target.value)}
                className="h-10 w-full rounded border border-border-light bg-white px-2 text-sm"
              >
                {collections.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {chosen && (
            <EntryForm
              key={chosen.id}
              collection={chosen}
              onSaved={chunk => onSaved(chunk.code)}
              onCancel={onClose}
            />
          )}
        </div>
      )}
    </Sheet>
  );
};
