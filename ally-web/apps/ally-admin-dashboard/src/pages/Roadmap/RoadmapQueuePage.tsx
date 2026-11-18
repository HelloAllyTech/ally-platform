import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Refresh } from "@icons";
import { MotionConfig, motion } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button, SidePanel } from "@ally-ui-mono/ui-shared";
import {
  rowsOfItemsResponse,
  useGetRoadmapItemsQuery,
  useMarkRoadmapItemReadMutation,
  useRoadmapV2Prefetch,
  useSetRoadmapWatchMutation,
} from "@api";
import { ROUTES, en } from "@constants";
import { useUser } from "@hooks";
import type { RoadmapQueueSort, RoadmapQueueView, RoadmapSavedView } from "@types";

import { useReducedMotionPreference } from "../../motion";
import { BottomSheet } from "./components/BottomSheet";
import {
  FilterButton,
  FilterChips,
  FilterSheet,
  useFilterOptions,
} from "./components/FilterControls";
import { ideaUrl } from "./components/IdeaControls";
import { IdeaView } from "./components/IdeaView";
import { NewIdeaButton } from "./components/NewIdeaButton";
import { QueueBoard } from "./components/QueueBoard";
import { QueueList } from "./components/QueueList";
import { QuickOpen } from "./components/QuickOpen";
import { RoadmapHelpMenu, RoadmapRoleTabs } from "./components/RoadmapAreaNav";
import { RoadmapBottomBar } from "./components/RoadmapBottomBar";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { SaveViewControls, SearchButton, SortSelect, ViewChips } from "./components/ViewBar";
import { usePullToRefresh } from "./hooks/usePullToRefresh";
import { useQueueSavedViews } from "./hooks/useQueueSavedViews";
import { useQueueTabOrder } from "./hooks/useQueueTabOrder";
import { hasReadingPane, useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { isRoadmapEntry, useRoadmapJobTimer } from "./hooks/useRoadmapJobTimer";
import { useRoadmapRealtime } from "./hooks/useRoadmapRealtime";
import { useKeyboardInset } from "./hooks/useVisualViewport";
import { useRoadmapRole } from "./RoadmapGate";
import { TriageView } from "./triage/TriageView";
import { queueKeyAction, stepSelection } from "./utils/keyboard";
import { ROADMAP_PREF_KEYS, readPref, writePref } from "./utils/prefs";
import {
  QueueFilters,
  QueueLayout,
  QueueState,
  decodeQueueState,
  encodeQueueState,
  hasActiveFilters,
  removeChip,
  stateFromSavedView,
  toItemsQuery,
  viewsForRole,
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
  const { role, can } = useRoadmapRole();
  const { user } = useUser();
  const breakpoint = useRoadmapBreakpoint();
  const touch = breakpoint === "phone" || breakpoint === "tablet";
  const isPhone = breakpoint === "phone";
  const withPane = hasReadingPane(breakpoint);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(
    () =>
      decodeQueueState(searchParams, role, {
        view: readPref<RoadmapQueueView | undefined>(ROADMAP_PREF_KEYS.lastView, undefined),
        layout: readPref<QueueLayout | undefined>(ROADMAP_PREF_KEYS.layout, undefined),
      }),
    [searchParams, role],
  );
  // The List / Board switch is retired: the Queue is always the list. The Board code below stays
  // so it can come back, but nothing selects it — not the switch, a saved pref or `?layout=board`.
  const layout = "list" as QueueLayout;

  const setState = useCallback(
    (next: QueueState, replace = true) => setSearchParams(encodeQueueState(next), { replace }),
    [setSearchParams],
  );

  useEffect(() => {
    writePref(ROADMAP_PREF_KEYS.lastView, state.view);
    writePref(ROADMAP_PREF_KEYS.layout, state.layout);
  }, [state.view, state.layout]);

  // ── data ────────────────────────────────────────────────────────────────────────────────────
  const [cursor, setCursor] = useState<string | undefined>();
  const baseQuery = useMemo(() => toItemsQuery(state), [state]);
  const baseKey = JSON.stringify(baseQuery);
  useEffect(() => setCursor(undefined), [baseKey]);
  const query = useMemo(() => (cursor ? { ...baseQuery, cursor } : baseQuery), [baseQuery, cursor]);
  const { data, isLoading, isFetching, isError, refetch } = useGetRoadmapItemsQuery(query, {
    skip: layout === "board",
  });

  // The For you badge (Needs you) and the To triage count. Same cache entry as an unfiltered view.
  const { data: forYou } = useGetRoadmapItemsQuery({ view: "for-you" });
  const forYouCount =
    forYou &&
    "sections" in forYou &&
    Array.isArray((forYou.sections as { needsYou?: unknown }).needsYou)
      ? (forYou.sections as { needsYou: unknown[] }).needsYou.length
      : undefined;
  const { data: triage } = useGetRoadmapItemsQuery(
    { view: "to-triage" },
    { skip: role !== "owner" },
  );
  const triageCount = triage ? rowsOfItemsResponse(triage).length : undefined;

  const rows = useMemo(() => rowsOfItemsResponse(data), [data]);
  const filterOptions = useFilterOptions(rows);
  const saved = useQueueSavedViews(state, user?.id);
  const { presence } = useRoadmapRealtime({
    enabled: true,
    currentUserId: user?.id,
    openCode: withPane ? state.open : null,
  });

  const prefetch = useRoadmapV2Prefetch("getRoadmapItem");
  const [markRead] = useMarkRoadmapItemReadMutation();
  const [setWatch] = useSetRoadmapWatchMutation();

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
      const row = state.view === "for-you" ? rows.find(r => r.code === code) : undefined;
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
  const [quickOpen, setQuickOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [actionSheetFor, setActionSheetFor] = useState<string | null>(null);
  const [triageOverlay, setTriageOverlay] = useState(false);
  const overlayOpen =
    quickOpen || shortcutsOpen || filterSheetOpen || !!actionSheetFor || triageOverlay;
  // To triage, for an Owner, is the triage screen (§4.6): its own rows, keys and Summary pane.
  const triageMode = state.view === "to-triage" && !!can.review && layout === "list";

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
  const onWatch = (code: string) => {
    setWatch({ code, level: "all" })
      .unwrap()
      .then(() => toast.success(copy.actions.watchLevel(copy.actions.watchLevels.all)))
      .catch(() => toast.error(copy.actions.watchFailed));
  };
  const onCopyLink = (code: string) => {
    navigator.clipboard
      .writeText(ideaUrl(code))
      .then(() => toast.success(copy.actions.copied))
      .catch(() => toast.error(copy.actions.copyFailed));
  };

  const { views, canReorder, reorder } = useQueueTabOrder(viewsForRole(role));
  const setView = (view: RoadmapQueueView) =>
    setState({ view, filters: {}, layout: state.layout, open: state.open }, false);
  const setFilters = (filters: QueueFilters) => setState({ ...state, filters });
  const setSort = (sort: RoadmapQueueSort) => setState({ ...state, sort });
  const selectSaved = (view: RoadmapSavedView) =>
    setState({
      ...stateFromSavedView(view.state.queue ?? {}, role, state.layout, view.id),
      open: state.open,
    });

  const filtered = hasActiveFilters(state.filters);
  const showSave = filtered || !!state.sort || saved.isDirty;

  const sortControl = (
    <SortSelect id="roadmap-queue-sort" view={state.view} sort={state.sort} onChange={setSort} />
  );

  // ── render ──────────────────────────────────────────────────────────────────────────────────
  const viewBar = (
    <div className="flex flex-col gap-2 border-b border-border-light px-4 py-2">
      <div className="flex items-center gap-2">
        <ViewChips
          views={views}
          active={state.view}
          activeSavedViewId={state.savedViewId}
          savedChips={saved.chips}
          savedOverflow={saved.overflow}
          forYouCount={forYouCount}
          triageCount={triageCount}
          onSelectView={setView}
          onSelectSaved={selectSaved}
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
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label={copy.refresh}
            className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded hover:bg-neutral-100"
          >
            <Refresh size={18} aria-hidden />
          </button>
        </div>
      )}
      {(filtered || showSave || saved.active) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterChips
            filters={state.filters}
            labels={filterOptions.labels}
            onRemove={chip => setFilters(removeChip(state.filters, chip))}
            onClear={() => setFilters({})}
          />
          <SaveViewControls
            visible={showSave}
            activeName={saved.active?.name}
            canUpdate={saved.canUpdate && saved.isDirty}
            canPin={!!can.pinView}
            activePinned={saved.active?.pinned}
            isSaving={saved.isSaving}
            onSave={async name => {
              const created = await saved.save(name);
              if (created) setState({ ...state, savedViewId: created.id });
            }}
            onUpdate={() => void saved.update()}
            onTogglePin={() => saved.active && void saved.togglePin(saved.active)}
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
        view={state.view}
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
        onWatch={onWatch}
        onCopyLink={onCopyLink}
        onLongPress={code => setActionSheetFor(code)}
        onPrefetch={code => prefetch(code)}
      />
      {isPhone && <div className="h-20" aria-hidden />}
    </div>
  );

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <div className="flex h-full min-h-0 flex-col bg-white">
        <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
          <div className="flex min-w-0 items-baseline gap-4">
            <h1 className="text-xl font-semibold text-typography-primary">{copy.title}</h1>
            {!isPhone && (
              <nav aria-label={copy.title} className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-typography-primary" aria-current="page">
                  {copy.mobile.queue}
                </span>
                <Link
                  to={ROUTES.ROADMAP_DRAFTS}
                  className="text-typography-secondary hover:underline"
                >
                  {copy.mobile.drafts}
                </Link>
                <Link
                  to={ROUTES.ROADMAP_BUGS}
                  className="text-typography-secondary hover:underline"
                >
                  {copy.mobile.bugs}
                </Link>
                <RoadmapRoleTabs role={role} />
                <RoadmapHelpMenu />
              </nav>
            )}
          </div>
          {!isPhone && <NewIdeaButton />}
          {isPhone && <SearchButton compact onClick={() => setQuickOpen(true)} />}
        </header>

        {viewBar}

        {layout === "board" ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <QueueBoard onOpen={openIdea} />
          </div>
        ) : triageMode ? (
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
                  onOpenFull={() => navigate(ROUTES.ROADMAP_IDEA(state.open!))}
                />
              ) : (
                <p className="p-6 text-sm text-typography-secondary">{copy.readingPaneEmpty}</p>
              )}
            </div>
          </div>
        ) : (
          list
        )}

        {/* On the Board, a card opens the same reading pane, over the lanes. */}
        {layout === "board" && (
          <SidePanel
            open={!!state.open}
            onClose={closePane}
            title={state.open ?? ""}
            closeLabel={copy.closePane}
            width="min(720px, 100vw)"
          >
            {state.open && (
              <IdeaView
                key={state.open}
                code={state.open}
                mode="pane"
                breakpoint={breakpoint}
                presence={presence}
                onOpenFull={() => navigate(ROUTES.ROADMAP_IDEA(state.open!))}
              />
            )}
          </SidePanel>
        )}

        {isPhone && (
          <RoadmapBottomBar hidden={barHidden || keyboardInset > 0} forYouCount={forYouCount} />
        )}

        <QuickOpen
          open={quickOpen}
          onClose={() => setQuickOpen(false)}
          onOpenIdea={openIdea}
          onOpenView={setView}
          views={views}
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
              {[
                { label: copy.row.openRow, run: () => openIdea(actionSheetFor) },
                { label: copy.row.watch, run: () => onWatch(actionSheetFor) },
                { label: copy.row.copyLink, run: () => onCopyLink(actionSheetFor) },
              ].map(action => (
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
