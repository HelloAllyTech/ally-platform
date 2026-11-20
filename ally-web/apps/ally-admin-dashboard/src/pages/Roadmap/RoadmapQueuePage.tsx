import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Refresh } from "@icons";
import { MotionConfig, motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  rowsOfItemsResponse,
  useGetRoadmapItemsQuery,
  useMarkRoadmapItemReadMutation,
  useRoadmapV2Prefetch,
} from "@api";
import { useClaimCommandPaletteShortcut } from "@components/command-palette/CommandPaletteContext";
import { ROUTES, en } from "@constants";
import { useUser } from "@hooks";
import type { RoadmapQueueSort, RoadmapSavedView } from "@types";

import { useReducedMotionPreference } from "../../motion";
import { BottomSheet } from "./components/BottomSheet";
import {
  FilterButton,
  FilterChips,
  FilterSheet,
  useFilterOptions,
} from "./components/FilterControls";
import { IdeaView } from "./components/IdeaView";
import { QueueList } from "./components/QueueList";
import { QueueSortSelect } from "./components/QueueSortSelect";
import { QueueTab, QueueTabs } from "./components/QueueTabs";
import { QuickOpen } from "./components/QuickOpen";
import { RoadmapBottomBar } from "./components/RoadmapBottomBar";
import { RoadmapIconButton } from "./components/RoadmapIconButton";
import { RoadmapTopNav } from "./components/RoadmapTopNav";
import { SavedViewControls } from "./components/SavedViewControls";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { SearchButton } from "./components/ViewBar";
import { usePullToRefresh } from "./hooks/usePullToRefresh";
import { useQueueSavedViews } from "./hooks/useQueueSavedViews";
import { useQueueTabOrder } from "./hooks/useQueueTabOrder";
import { useQueueViewSorts } from "./hooks/useQueueViewSorts";
import { hasReadingPane, useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { isRoadmapEntry, useRoadmapJobTimer } from "./hooks/useRoadmapJobTimer";
import { useRoadmapRealtime } from "./hooks/useRoadmapRealtime";
import { useKeyboardInset } from "./hooks/useVisualViewport";
import { useRoadmapRole } from "./RoadmapGate";
import { TriageView } from "./triage/TriageView";
import { queueKeyAction, stepSelection } from "./utils/keyboard";
import { ROADMAP_PREF_KEYS, readPref, writePref } from "./utils/prefs";
import {
  DEFAULT_VIEWS,
  DEFAULT_VIEW_IDS,
  DefaultViewId,
  QueueFilters,
  QueueState,
  decodeQueueState,
  defaultSortFor,
  encodeQueueState,
  hasActiveFilters,
  removeChip,
  stateFromSavedView,
  toItemsQuery,
} from "./utils/queueState";

/**
 * Roadmap → Queue (§4.3): the inbox. Role-scoped views, one Filter menu with chips, sorts, saved
 * views, unread dots and the why-here line; List | Board for Builders and Owners; the reading pane
 * from laptop width up. Every bit of state that matters lives in the URL (§4.11), so Back returns
 * to the same view, filters and selection, and a link reproduces it exactly.
 */
export const RoadmapQueuePage: React.FC = () => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  const { can } = useRoadmapRole();
  const { user } = useUser();
  const breakpoint = useRoadmapBreakpoint();
  const touch = breakpoint === "phone" || breakpoint === "tablet";
  const isPhone = breakpoint === "phone";
  const withPane = hasReadingPane(breakpoint);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(
    () =>
      decodeQueueState(searchParams, {
        view: readPref<string | undefined>(ROADMAP_PREF_KEYS.lastView, undefined),
      }),
    [searchParams],
  );
  const setState = useCallback(
    (next: QueueState, replace = true) => setSearchParams(encodeQueueState(next), { replace }),
    [setSearchParams],
  );

  useEffect(() => {
    writePref(ROADMAP_PREF_KEYS.lastView, state.view);
  }, [state.view]);

  // ── data ────────────────────────────────────────────────────────────────────────────────────
  // The sort in force: the URL's, else (on a default view) the one this person chose for it, else
  // the view's own. A saved view keeps its sort in the view.
  const sortPrefs = useQueueViewSorts();
  const chosenSort = state.sort ?? (state.savedViewId ? undefined : sortPrefs.sortFor(state.view));
  const currentSort: RoadmapQueueSort =
    chosenSort ?? defaultSortFor(state.savedViewId ? "saved" : state.view);
  const queryState = useMemo(() => ({ ...state, sort: chosenSort }), [state, chosenSort]);
  // To do is where an Owner triages: its own list and tools, on a default view only.
  const triageMode = state.view === "todo" && !state.savedViewId && !!can.review;

  const [cursor, setCursor] = useState<string | undefined>();
  // To do shows the whole Backlog (the triage list has no pages), the rest a page at a time.
  const baseQuery = useMemo(
    () => ({ ...toItemsQuery(queryState), ...(triageMode ? { limit: "200" } : {}) }),
    [queryState, triageMode],
  );
  const baseKey = JSON.stringify(baseQuery);
  useEffect(() => setCursor(undefined), [baseKey]);
  const query = useMemo(() => (cursor ? { ...baseQuery, cursor } : baseQuery), [baseQuery, cursor]);
  const { data, isLoading, isFetching, isError, refetch } = useGetRoadmapItemsQuery(query);

  // The To do count on its tab: how many ideas are in the Backlog.
  const { data: backlog } = useGetRoadmapItemsQuery({ view: "all", stage: "backlog" });
  const todoCount = backlog && "total" in backlog ? backlog.total : undefined;

  const rows = useMemo(() => rowsOfItemsResponse(data), [data]);
  const filterOptions = useFilterOptions(rows, state.view !== "all" && !state.savedViewId);
  const saved = useQueueSavedViews(state, user?.id);
  const { presence } = useRoadmapRealtime({
    enabled: true,
    currentUserId: user?.id,
    openCode: withPane ? state.open : null,
  });

  const prefetch = useRoadmapV2Prefetch("getRoadmapItem");
  const [markRead] = useMarkRoadmapItemReadMutation();

  // ── selection, opening, focus ───────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<string | undefined>(state.open);
  const visibleCodes = useRef<string[]>([]);
  const onVisibleCodes = useCallback((codes: string[]) => {
    visibleCodes.current = codes;
  }, []);
  const paneHeadingRef = useRef<HTMLHeadingElement>(null);

  const focusRow = (code: string | undefined) => {
    if (!code) return;
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"] button[aria-label]`)
        ?.focus(),
    );
  };

  // P8 job timing (§4.16): opening the Roadmap starts "find my idea"; opening an idea from a For
  // you row that is an agent question (the notification) starts answering it.
  const jobs = useRoadmapJobTimer();
  useEffect(() => {
    if (isRoadmapEntry()) jobs.start("find_my_idea");
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openIdea = useCallback(
    (code: string) => {
      const row = state.filters.needsYou ? rows.find(r => r.code === code) : undefined;
      if (row?.whyHere?.kind === "agentQuestion") {
        jobs.start("answer_from_notification", { itemId: code, restart: true });
      }
      setSelected(code);
      if (withPane) {
        setState({ ...state, open: code });
        requestAnimationFrame(() => paneHeadingRef.current?.focus());
      } else {
        navigate(ROUTES.ROADMAP_IDEA(code));
      }
    },
    [withPane, setState, state, navigate, rows, jobs],
  );

  const closePane = useCallback(() => {
    const code = state.open;
    setState({ ...state, open: undefined });
    focusRow(code);
  }, [setState, state]);

  // ── keyboard (§4.10) ────────────────────────────────────────────────────────────────────────
  // ⌘K here is the Queue's own quick open, not the global page palette.
  useClaimCommandPaletteShortcut();
  const [quickOpen, setQuickOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [actionSheetFor, setActionSheetFor] = useState<string | null>(null);
  const [triageOverlay, setTriageOverlay] = useState(false);
  const overlayOpen =
    quickOpen || shortcutsOpen || filterSheetOpen || !!actionSheetFor || triageOverlay;
  // To triage, for an Owner, is the triage screen (§4.6): its own rows, keys and Summary pane.

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = queueKeyAction(event);
      if (!action) return;
      if (action === "quickOpen") {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }
      if (overlayOpen || event.defaultPrevented) return;
      // Shortcuts belong to the list; a Carbon menu or dialog that has focus keeps its own keys.
      const inMenu = (event.target as HTMLElement | null)?.closest?.(
        "[role='menu'], [role='dialog']",
      );
      if (inMenu) return;
      switch (action) {
        case "next":
        case "previous": {
          event.preventDefault();
          const next = stepSelection(visibleCodes.current, selected, action === "next" ? 1 : -1);
          setSelected(next);
          focusRow(next);
          if (next) prefetch(next);
          break;
        }
        case "open":
          if (selected && document.activeElement?.closest?.("[data-code]")) {
            event.preventDefault();
            openIdea(selected);
          }
          break;
        case "close":
          if (state.open) {
            event.preventDefault();
            closePane();
          }
          break;
        case "help":
          event.preventDefault();
          setShortcutsOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen, selected, prefetch, openIdea, closePane, state.open]);

  // ── frozen order ────────────────────────────────────────────────────────────────────────────
  const [pointerOver, setPointerOver] = useState(false);
  const [releaseToken, setReleaseToken] = useState(0);
  const held = pointerOver || !!state.open;

  // ── phone chrome: bottom bar follows scroll direction; hides with the keyboard ───────────────
  const keyboardInset = useKeyboardInset();
  const [barHidden, setBarHidden] = useState(false);
  const lastScroll = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const onListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    if (Math.abs(top - lastScroll.current) > 8) setBarHidden(top > lastScroll.current && top > 56);
    lastScroll.current = top;
  };
  const refresh = useCallback(async () => {
    setCursor(undefined);
    await refetch();
  }, [refetch]);
  const pull = usePullToRefresh(() => listRef.current, refresh, touch);

  // ── actions ─────────────────────────────────────────────────────────────────────────────────
  const onMarkRead = (code: string) => void markRead(code);

  const setView = (view: DefaultViewId) => setState({ view, filters: {}, open: state.open }, false);
  const setFilters = (filters: QueueFilters) => setState({ ...state, filters });
  const setSort = (sort: RoadmapQueueSort) => {
    if (state.savedViewId) {
      setState({ ...state, sort });
    } else {
      // A default view remembers its sort for you; the URL stays plain.
      void sortPrefs.setSortFor(state.view, sort);
      if (state.sort) setState({ ...state, sort: undefined });
    }
  };
  const selectSaved = (view: RoadmapSavedView) =>
    setState({
      ...stateFromSavedView(view.state.queue ?? {}, view.id),
      open: state.open,
    });

  // Tabs: the five default views, then the person's own, in the order they keep.
  const tabLookup = useMemo(() => {
    const map = new Map<string, QueueTab>();
    DEFAULT_VIEW_IDS.forEach(id =>
      map.set(id, {
        id,
        label: copy.views[id],
        help: copy.viewsHelp[id],
        badge: id === "todo" ? todoCount : undefined,
      }),
    );
    saved.views.forEach(view => map.set(view.id, { id: view.id, label: view.name }));
    return map;
  }, [copy.views, copy.viewsHelp, saved.views, todoCount]);
  const { views: tabIds, canReorder, reorder } = useQueueTabOrder([...tabLookup.keys()]);
  const tabs = tabIds.map(id => tabLookup.get(id)!).filter(Boolean);
  const onSelectTab = (id: string) => {
    const view = saved.views.find(v => v.id === id);
    if (view) selectSaved(view);
    else setView(id as DefaultViewId);
  };

  const filtered = hasActiveFilters(state.filters);
  // Something to save as a new view: filters, or a sort that isn't the view's own. On a saved view
  // the controls offer Update instead once it has changed.
  const canSaveAsView =
    !state.savedViewId && (filtered || currentSort !== DEFAULT_VIEWS[state.view].sort);

  const sortControl = (
    <QueueSortSelect id="roadmap-queue-sort" sort={currentSort} onChange={setSort} />
  );

  // ── render ──────────────────────────────────────────────────────────────────────────────────
  const viewBar = (
    <div className="flex flex-col gap-2 border-b border-border-light px-4 py-2">
      <div className="flex items-center gap-2">
        <QueueTabs
          tabs={tabs}
          active={state.savedViewId ?? state.view}
          onSelect={onSelectTab}
          onReorder={canReorder ? reorder : undefined}
          scroll={touch}
        />
        {!touch && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <FilterButton filters={state.filters} options={filterOptions} onChange={setFilters} />
            {sortControl}
            <SearchButton onClick={() => setQuickOpen(true)} />
          </div>
        )}
      </div>
      {touch && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterSheetOpen(true)}
            className="inline-flex min-h-11 items-center gap-1 rounded border border-border-light px-3 text-sm"
          >
            {copy.mobile.filterSort}
          </button>
          <RoadmapIconButton label={copy.refresh} onClick={() => void refresh()} large>
            <Refresh size={18} aria-hidden />
          </RoadmapIconButton>
        </div>
      )}
      {(filtered || canSaveAsView || saved.active) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterChips
            filters={state.filters}
            labels={filterOptions.labels}
            onRemove={chip => setFilters(removeChip(state.filters, chip))}
            onClear={() => setFilters({})}
          />
          <SavedViewControls
            canSaveAsView={canSaveAsView}
            active={saved.active}
            isDirty={saved.isDirty}
            isSaving={saved.isSaving}
            onSave={async name => {
              const created = await saved.save(name);
              if (created) setState({ ...state, savedViewId: created.id });
            }}
            onUpdate={() => void saved.update()}
            onRename={saved.rename}
            onDelete={async view => {
              const ok = await saved.remove(view);
              if (ok && state.savedViewId === view.id) setView("all");
              return ok;
            }}
          />
        </div>
      )}
    </div>
  );

  const list = (
    <div
      ref={listRef}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      onScroll={onListScroll}
      onPointerEnter={event => {
        if (event.pointerType !== "touch" && event.pointerType !== "pen") setPointerOver(true);
      }}
      onPointerLeave={() => setPointerOver(false)}
      {...pull.handlers}
    >
      {touch && (pull.distance > 0 || pull.refreshing) && (
        <div
          className="flex justify-center py-2"
          style={{ height: pull.distance + 16 }}
          aria-live="polite"
        >
          <motion.span
            className="inline-flex text-typography-secondary"
            animate={
              pull.refreshing && !reduced
                ? { rotate: 360, transition: { repeat: Infinity, duration: 0.8, ease: "linear" } }
                : { rotate: pull.distance * 4 }
            }
            aria-label={pull.armed ? copy.releaseToRefresh : copy.pullToRefresh}
          >
            <Refresh size={20} aria-hidden />
          </motion.span>
        </div>
      )}
      <QueueList
        view="all"
        data={data}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        onRetry={() => void refetch()}
        filtered={filtered}
        onClearFilters={() => setFilters({})}
        onSeeAll={() => setView("all")}
        selected={state.open ?? selected}
        touch={touch}
        held={held}
        onRelease={() => setReleaseToken(t => t + 1)}
        releaseToken={releaseToken}
        onLoadMore={() => {
          if (data && "rows" in data && data.nextCursor) setCursor(data.nextCursor);
        }}
        onVisibleCodes={onVisibleCodes}
        onOpen={openIdea}
        onMarkRead={onMarkRead}
        onLongPress={code => setActionSheetFor(code)}
        onPrefetch={code => prefetch(code)}
      />
      {isPhone && <div className="h-20" aria-hidden />}
    </div>
  );

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <div className="flex h-full min-h-0 flex-col bg-white">
        {isPhone && (
          <RoadmapTopNav
            phone
            phoneTrailing={<SearchButton compact onClick={() => setQuickOpen(true)} />}
          />
        )}

        {viewBar}

        {triageMode ? (
          <TriageView
            data={data}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            breakpoint={breakpoint}
            selected={selected}
            open={withPane ? state.open : undefined}
            onOpen={openIdea}
            onVisibleCodes={onVisibleCodes}
            onOverlay={setTriageOverlay}
            onLoadMore={
              data && "rows" in data && data.nextCursor
                ? () => setCursor((data as { nextCursor?: string }).nextCursor)
                : undefined
            }
          />
        ) : withPane ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,2fr)_3fr]">
            <div className="flex min-h-0 flex-col border-r border-border-light">{list}</div>
            <div className="min-h-0 overflow-hidden">
              {state.open ? (
                <IdeaView
                  key={state.open}
                  code={state.open}
                  mode="pane"
                  breakpoint={breakpoint}
                  presence={presence}
                  headingRef={paneHeadingRef}
                  onClose={closePane}
                />
              ) : (
                <p className="p-6 text-sm text-typography-secondary">{copy.readingPaneEmpty}</p>
              )}
            </div>
          </div>
        ) : (
          list
        )}

        {isPhone && <RoadmapBottomBar hidden={barHidden || keyboardInset > 0} />}

        <QuickOpen
          open={quickOpen}
          onClose={() => setQuickOpen(false)}
          onOpenIdea={openIdea}
          onOpenView={id => setView(id as DefaultViewId)}
          views={DEFAULT_VIEW_IDS}
          fullScreen={isPhone}
        />
        <ShortcutsDialog
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
          triage={triageMode}
        />
        {touch && (
          <FilterSheet
            open={filterSheetOpen}
            onClose={() => setFilterSheetOpen(false)}
            state={state}
            options={filterOptions}
            onApply={setFilters}
            sortControl={sortControl}
          />
        )}
        <BottomSheet
          open={!!actionSheetFor}
          onClose={() => setActionSheetFor(null)}
          title={actionSheetFor ?? ""}
          closeLabel={copy.mobile.close}
        >
          {actionSheetFor && (
            <div className="flex flex-col gap-2">
              {[{ label: copy.row.openRow, run: () => openIdea(actionSheetFor) }].map(action => (
                <Button
                  key={action.label}
                  kind="secondary"
                  size="lg"
                  className="w-full max-w-none"
                  onClick={() => {
                    setActionSheetFor(null);
                    action.run();
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </BottomSheet>
      </div>
    </MotionConfig>
  );
};
