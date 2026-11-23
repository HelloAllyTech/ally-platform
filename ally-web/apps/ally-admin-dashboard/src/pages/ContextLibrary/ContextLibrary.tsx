import React, { useCallback, useMemo, useRef, useState } from "react";

import { BarChart3, Building2, Library, PlugZap, Settings2 } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { useGetContextCollectionsQuery, useGetPermissionsQuery, useGetTenantsQuery } from "@api";
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
import { ConnectSheet } from "./ConnectSheet";
import { capitalise, errorReason, nounsFor, takesEntries } from "./contextLibraryFormat";
import { ContextLibraryScopeContext, useContextLibraryAccess } from "./contextLibraryScope";
import { InlineError, LoadingRows, Segmented } from "./ContextLibraryUi";
import { DocumentSheet, DocumentsView } from "./DocumentsView";
import { EntryForm } from "./EntryForm";
import { InsightsView } from "./InsightsView";
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
 * as a history entry (`?chunk=`, `?document=`, `?sheet=new|bulk|connect`), so Back closes it and a
 * link to one opens it.
 *
 * Documents can be dropped anywhere on the page. The upload dock that follows them lives in
 * the admin layout (`UploadDockHost`), so it keeps going when you leave this page.
 *
 * An organisation's admin (§10.2) sees the same page narrowed to one organisation (`?org=`, one of
 * theirs): only the collections that take organisation entries, their own entries to write and
 * Ally's global ones to read, Library and Insights only. Every request goes to the organisation
 * routes, which the server scopes again; hiding things here is for the admin, not for safety.
 */
export const ContextLibrary: React.FC = () => {
  const strings = en.contextLibrary;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const access = useContextLibraryAccess();
  const orgMode = access.mode === "organisation";
  const { data: tenantData } = useGetTenantsQuery({ limit: 200 }, { skip: !access.mode });
  const orgNames = useMemo(
    () => Object.fromEntries((tenantData?.data ?? []).map(t => [t.id, t.name])),
    [tenantData],
  );
  const orgChoices = useMemo(() => {
    if (!orgMode) return [];
    const ids = access.orgIds ?? (tenantData?.data ?? []).map(t => t.id);
    return ids
      .map(id => ({ id, name: orgNames[id] ?? strings.org.pickerLabel }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orgMode, access.orgIds, tenantData, orgNames, strings.org.pickerLabel]);
  const requestedOrg = params.get("org");
  const tenantId = orgMode
    ? (orgChoices.find(o => o.id === requestedOrg) ?? orgChoices[0])?.id
    : undefined;
  const views = orgMode ? VIEWS.filter(v => v !== "settings") : VIEWS;

  const requestedView = parseView(params.get("view"));
  const view = views.includes(requestedView) ? requestedView : "library";
  const requestedCollection = params.get("collection") || null;
  const listMode: ListMode = params.get("list") === "documents" ? "documents" : "entries";
  const chunkCode = params.get("chunk");
  const documentId = params.get("document");
  const sheet = params.get("sheet");

  const collectionsQuery = useGetContextCollectionsQuery(orgMode ? { tenantId } : undefined, {
    skip: orgMode && !tenantId,
  });
  const collections = useMemo(() => collectionsQuery.data ?? [], [collectionsQuery.data]);
  // The organisation routes list entries one collection at a time, so there is no "All" there.
  const collectionId = requestedCollection ?? (orgMode ? (collections[0]?.id ?? null) : null);
  const current: ContextCollection | undefined = collections.find(c => c.id === collectionId);
  const { data: permissions } = useGetPermissionsQuery();
  const canEdit = orgMode
    ? access.canEdit
    : ((permissions ?? []) as string[]).includes(Permissions.EDIT_CONTEXT_LIBRARY);
  const scope = useMemo(() => ({ tenantId, orgNames }), [tenantId, orgNames]);
  const ownEmpty = orgMode && current?.ownActive === 0;

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
  const setOrg = (id: string) =>
    setParams(withChanges({ org: id, chunk: null, document: null, sheet: null }));
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
      audience: choice.audience,
    });
  }, []);

  /**
   * Every drop goes through the dialog: it names what is skipped and asks where the documents go
   * and which organisations their entries reach. Add is focused, so Enter confirms the defaults.
   */
  const receiveFiles = useCallback((files: File[]) => setStaged(files), []);

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
    if (orgMode && !orgChoices.length && tenantData) {
      return <p className="py-8 text-sm text-typography-600">{strings.org.none}</p>;
    }
    if (collectionsQuery.isLoading || (orgMode && !tenantId)) return <LoadingRows />;
    if (collectionsQuery.isError) {
      return (
        <InlineError
          what={strings.title}
          reason={errorReason(collectionsQuery.error)}
          onRetry={() => void collectionsQuery.refetch()}
        />
      );
    }
    if (libraryEmpty && listMode === "entries" && !orgMode) {
      return (
        <FirstRunHero
          documentCollections={documentCollections}
          initialTargets={targets}
          canEdit={canEdit}
          onFiles={(files, chosen) => {
            rememberTargets(chosen);
            setStaged(files);
          }}
          onWrite={() => pushOverlay({ sheet: "new" })}
        />
      );
    }
    return (
      <div className="space-y-4">
        {ownEmpty && (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border-light bg-neutral-50 px-4 py-3 text-sm"
            data-testid="cl-org-empty"
          >
            <Building2 size={16} aria-hidden className="shrink-0 text-typography-600" />
            <span className="text-typography-800">{strings.org.emptyOwn}</span>
            {canEdit && current && takesEntries(current) && (
              <button
                type="button"
                onClick={() => pushOverlay({ sheet: "new" })}
                className="ml-auto inline-flex h-9 items-center rounded border border-border-light bg-white px-3 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
              >
                {strings.add.entry}
              </button>
            )}
          </div>
        )}
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
            key={`${tenantId ?? "platform"}:${current?.id ?? "all"}`}
            collection={current}
            collections={collections}
            initialAudience={params.get("audience") ?? undefined}
            onOpenChunk={code => pushOverlay({ chunk: code })}
          />
        )}
      </div>
    );
  };

  return (
    <ContextLibraryScopeContext.Provider value={scope}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="context-library-page">
        <header className="flex flex-wrap items-center gap-3">
          <div className="mr-2">
            <h1 className="text-2xl font-semibold text-typography-900">{strings.title}</h1>
            <p className="text-sm text-typography-600">
              {orgMode ? strings.org.subtitle : strings.subtitle}
            </p>
          </div>
          {orgMode && orgChoices.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">{strings.org.pickerLabel}</span>
              <select
                value={tenantId ?? ""}
                onChange={event => setOrg(event.target.value)}
                className="h-10 rounded border border-border-light bg-white px-2 text-sm"
                data-testid="cl-org-switcher"
              >
                {orgChoices.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">{strings.switcher.label}</span>
            <select
              value={collectionId ?? ""}
              onChange={event => setCollection(event.target.value)}
              className="h-10 rounded border border-border-light bg-white px-2 text-sm"
              data-testid="cl-collection-switcher"
            >
              {!orgMode && <option value="">{strings.switcher.all}</option>}
              {collections.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.counts?.active ?? 0})
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!orgMode && (
              <button
                type="button"
                onClick={() => pushOverlay({ sheet: "connect" })}
                className="inline-flex h-10 items-center gap-2 rounded border border-border-light bg-white px-3 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                data-testid="cl-connect-button"
              >
                <PlugZap size={16} aria-hidden /> {strings.connect.button}
              </button>
            )}
            {canEdit && (
              <AddMenu
                canUpload={current ? current.takesDocuments : documentCollections.length > 0}
                canWrite={current ? takesEntries(current) : entryCollections.length > 0}
                onChoose={onAdd}
              />
            )}
          </div>
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
          {views.map(id => {
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
            <InsightsView
              collection={current}
              collections={collections}
              canEdit={canEdit}
              onPickCollection={setCollection}
              onUpload={() => fileInputRef.current?.click()}
              onNewEntry={() => pushOverlay({ sheet: "new" })}
              onOpenChunk={code => pushOverlay({ chunk: code })}
            />
          )}
          {view === "settings" && !orgMode && (
            <SettingsView
              collections={collections}
              collection={current}
              canEdit={canEdit}
              onConnect={() => pushOverlay({ sheet: "connect" })}
            />
          )}
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
            canEdit={canEdit && !orgMode}
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
        {sheet === "connect" && !orgMode && <ConnectSheet onClose={() => closeOverlay("sheet")} />}
        {sheet === "bulk" && canEdit && (
          <BulkUpload
            collections={collections}
            initialCollectionId={current?.id}
            onClose={() => closeOverlay("sheet")}
          />
        )}
      </div>
    </ContextLibraryScopeContext.Provider>
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
