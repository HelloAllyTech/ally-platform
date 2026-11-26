import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Chat, Close, Menu, Search, Settings } from "@carbon/icons-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ReactReduxContext } from "react-redux";
import { useNavigate } from "react-router-dom";

import { SidePanel } from "@ally-ui-mono/ui-shared";
import {
  productManualAPI,
  useGetManualPageQuery,
  useGetManualStateQuery,
  useGetManualTreeQuery,
} from "@api";
import { useClaimCommandPaletteShortcut } from "@components/command-palette";
import { ROUTES, TAG_TYPES, en } from "@constants";

import "../../../components/v2/core/tokens.css";
import "./manual.css";
import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { BottomSheet } from "../components/BottomSheet";
import { RoadmapAreaHeader } from "../components/RoadmapAreaHeader";
import { RoadmapBottomBar } from "../components/RoadmapBottomBar";
import { useRoadmapBreakpoint } from "../hooks/useRoadmapBreakpoint";
import { AdminDrawer } from "./components/AdminDrawer";
import { ChangeLogPanel } from "./components/ChangeLogPanel";
import { ChatPanel } from "./components/ChatPanel";
import { ManualHome } from "./components/ManualHome";
import { MapPanel } from "./components/MapPanel";
import { PageSkeleton, PageView } from "./components/PageView";
import { SearchPalette } from "./components/SearchPalette";
import { MANUAL_STATE_POLL_MS, StateBanner, StateFooter } from "./components/StateBanner";
import { ManualMessage } from "./components/StateViews";
import { TreeRail } from "./components/TreeRail";
import { useManualChatStream } from "./hooks/useManualChatStream";
import { ManualDataContext, usePageVisible } from "./hooks/useManualData";
import { useRecentPages } from "./hooks/useRecentPages";

import type { ManualChatServerEvent } from "./utils/chatState";

export type ManualMode = "read" | "split";
export type ManualView = "reader" | "map";

/** The split's glide: a spring that settles in about 280 ms; a ≤100 ms fade when reduced. */
const splitTransition = (reduced: boolean) =>
  reduced
    ? motionTransition("fast", "productive", true)
    : ({ type: "spring", stiffness: 420, damping: 42, mass: 0.8 } as const);

/** Cmd/Ctrl + `key`, ignoring Shift/Alt chords. */
const chord = (event: KeyboardEvent, key: string) =>
  (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === key;

/** A Carbon modal is showing above the page: Escape belongs to it. */
const modalOpen = () =>
  typeof document !== "undefined" && !!document.querySelector(".cds--modal.is-visible");

const toolbarButton =
  "inline-flex h-8 items-center gap-1.5 px-2.5 text-sm text-typography-800 hover:bg-neutral-100 aria-pressed:bg-neutral-900 aria-pressed:text-white";

/**
 * The Product Manual's two modes. READ: a calm reading column beside the journey tree. SPLIT: the
 * same page, with Ask the manual alongside — the reading column moves over (a shared layout
 * animation; the scroll container never remounts, so your place is kept) and the chat slides in.
 * Ask, Cmd/Ctrl+/ and choosing Ask on a selection open it; Escape or Close leaves it.
 *
 * Phones keep the page full width: the chat is a bottom sheet over it and the tree a drawer.
 */
export const ManualShell: React.FC<{ slug: string | null }> = ({ slug }) => {
  const copy = en.productManual;
  const navigate = useNavigate();
  const reduced = useReducedMotionPreference();
  const breakpoint = useRoadmapBreakpoint();
  const phone = breakpoint === "phone";
  const compact = phone || breakpoint === "tablet";
  useClaimCommandPaletteShortcut();

  const tree = useGetManualTreeQuery();
  const pages = useMemo(() => tree.data ?? [], [tree.data]);
  const data = useMemo(
    () => ({ pages, bySlug: new Map(pages.map(page => [page.slug, page])) }),
    [pages],
  );
  const visible = usePageVisible();
  const { data: manualState } = useGetManualStateQuery(undefined, {
    pollingInterval: visible ? MANUAL_STATE_POLL_MS : 0,
    skipPollingIfUnfocused: true,
  });
  // The page title for the change-log heading, from the cache the reader already filled.
  const { data: pageDetail } = useGetManualPageQuery(slug ?? "", { skip: !slug });

  const [mode, setMode] = useState<ManualMode>("read");
  const [view, setView] = useState<ManualView>("reader");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [changes, setChanges] = useState<{ open: boolean; slug: string | null }>({
    open: false,
    slug: null,
  });
  const [adminOpen, setAdminOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const { recent, remember } = useRecentPages();

  // A live edit by the chat: refresh that page, the tree and the change log underneath the reader.
  const store = useContext(ReactReduxContext)?.store;
  const onEvent = useCallback(
    (event: ManualChatServerEvent) => {
      if (event.type !== "page_edited" || !store) return;
      store.dispatch(
        productManualAPI.util.invalidateTags([
          { type: TAG_TYPES.PRODUCT_MANUAL_PAGE, id: event.data.slug },
          { type: TAG_TYPES.PRODUCT_MANUAL_TREE, id: "ALL" },
          { type: TAG_TYPES.PRODUCT_MANUAL_TREE, id: "GRAPH" },
          { type: TAG_TYPES.PRODUCT_MANUAL_CHANGES, id: event.data.slug },
          { type: TAG_TYPES.PRODUCT_MANUAL_CHANGES, id: "ALL" },
        ]),
      );
    },
    [store],
  );
  const stream = useManualChatStream({ onEvent });

  const openPage = useCallback(
    (next: string) => {
      setView("reader");
      setDrawerOpen(false);
      navigate(ROUTES.ROADMAP_MANUAL_PAGE(next));
    },
    [navigate],
  );

  // A new page starts at its top; switching modes keeps your place (the scroller never remounts).
  const scrollerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    scrollerRef.current?.scrollTo?.({ top: 0 });
  }, [slug, view]);

  const openSplit = useCallback(() => setMode("split"), []);
  const closeSplit = useCallback(() => setMode("read"), []);

  // Keyboard: Cmd/Ctrl+K search, Cmd/Ctrl+/ ask, Escape leaves the split.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Escape closes the topmost thing: the palette, a panel or a modal before the split.
  const overlayRef = useRef(false);
  overlayRef.current = paletteOpen || changes.open || adminOpen || drawerOpen;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (chord(event, "k")) {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (chord(event, "/")) {
        event.preventDefault();
        setMode(current => (current === "split" ? "read" : "split"));
      } else if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        modeRef.current === "split" &&
        !overlayRef.current &&
        !modalOpen()
      ) {
        setMode("read");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const askSelection = useCallback(
    (text: string, kind: "ask" | "draft") => {
      setMode("split");
      void stream.send(kind === "ask" ? copy.selection.askPrompt : copy.selection.draftPrompt, {
        ...(slug ? { pageSlug: slug } : {}),
        selection: text,
      });
    },
    [stream, slug, copy.selection.askPrompt, copy.selection.draftPrompt],
  );

  const askFromPalette = useCallback((query: string) => {
    setMode("split");
    setPrefill({ text: query, nonce: Date.now() });
  }, []);

  const openChanges = useCallback((target: string | null) => {
    setChanges({ open: true, slug: target });
  }, []);

  const rail = (
    <TreeRail
      pages={pages}
      currentSlug={slug}
      onNavigate={openPage}
      onOpenRecentChanges={() => openChanges(null)}
      footer={
        <StateFooter
          state={manualState}
          onOpenGaps={manualState?.canAdminister ? () => setAdminOpen(true) : undefined}
        />
      }
    />
  );

  const reader = (() => {
    if (tree.isLoading) return <PageSkeleton />;
    if (tree.isError) {
      return <ManualMessage title={copy.loadFailed} action={copy.retry} onAction={tree.refetch} />;
    }
    if (view === "map") return <MapPanel currentSlug={slug} onOpen={openPage} />;
    if (!slug) return <ManualHome />;
    return (
      <PageView
        slug={slug}
        onAskSelection={askSelection}
        onOpenChanges={target => openChanges(target)}
        onSearch={() => setPaletteOpen(true)}
        onLoaded={remember}
        showContents={mode === "read"}
      />
    );
  })();

  const chat = (
    <ChatPanel
      stream={stream}
      analyticsAvailable={!!manualState?.analyticsAvailable}
      onClose={closeSplit}
      onViewChange={target => openChanges(target)}
      prefill={prefill}
      pageSlug={slug}
    />
  );

  const split = mode === "split";
  return (
    <ManualDataContext.Provider value={data}>
      <div className="ally-v2 manual-root flex h-full min-h-0 flex-col" data-mode={mode}>
        <RoadmapAreaHeader phone={phone} current={copy.title} />
        <StateBanner state={manualState} />
        <div
          role="toolbar"
          aria-label={copy.title}
          className="flex h-11 shrink-0 items-center gap-1 border-b border-border-light px-3"
        >
          {compact && (
            <button
              type="button"
              className={toolbarButton}
              onClick={() => setDrawerOpen(true)}
              aria-label={copy.openContents}
            >
              <Menu size={16} aria-hidden />
              {!phone && copy.openContents}
            </button>
          )}
          <button
            type="button"
            className={`${toolbarButton} min-w-0 flex-1 justify-start text-typography-500 sm:max-w-xs`}
            onClick={() => setPaletteOpen(true)}
            aria-label={copy.searchShortcut}
            aria-haspopup="dialog"
          >
            <Search size={16} aria-hidden />
            <span className="truncate">{copy.palette.placeholder}</span>
            <kbd className="ml-auto hidden font-sans text-xs text-typography-500 sm:inline">⌘K</kbd>
          </button>
          <span className="flex-1" />
          <div role="group" aria-label={copy.modeLabel} className="flex">
            <button
              type="button"
              className={toolbarButton}
              aria-pressed={view === "reader"}
              onClick={() => setView("reader")}
            >
              {copy.reader}
            </button>
            <button
              type="button"
              className={toolbarButton}
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              {copy.map}
            </button>
          </div>
          <button
            type="button"
            className={`${toolbarButton} ml-1`}
            aria-pressed={split}
            aria-label={copy.askAria}
            title={copy.askAria}
            onClick={() => (split ? closeSplit() : openSplit())}
          >
            {split ? <Close size={16} aria-hidden /> : <Chat size={16} aria-hidden />}
            {copy.ask}
          </button>
          {manualState?.canAdminister && (
            <button
              type="button"
              className={toolbarButton}
              aria-label={copy.settings}
              title={copy.settings}
              onClick={() => setAdminOpen(true)}
            >
              <Settings size={16} aria-hidden />
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          {!compact && (
            <aside className="w-[var(--manual-rail)] shrink-0 border-r border-border-light">
              {rail}
            </aside>
          )}
          <LayoutGroup>
            <main
              ref={scrollerRef}
              className={`manual-scroll min-h-0 min-w-0 flex-1 overflow-y-auto ${phone ? "pb-24" : ""}`}
              aria-busy={tree.isFetching}
            >
              <motion.div
                layout={reduced ? false : "position"}
                transition={splitTransition(reduced)}
                className={`mx-auto w-full px-5 py-8 sm:px-8 ${
                  view === "map" ? "max-w-none" : split ? "max-w-[46rem]" : "max-w-[64rem]"
                }`}
              >
                {reader}
              </motion.div>
            </main>
            {!phone && (
              <AnimatePresence initial={false}>
                {split && (
                  <motion.aside
                    key="manual-chat"
                    layout={!reduced}
                    className="w-[var(--manual-chat)] max-w-[45vw] shrink-0 overflow-hidden border-l border-border-light"
                    initial={reduced ? { opacity: 0 } : { opacity: 0, x: 48 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, x: 48 }}
                    transition={splitTransition(reduced)}
                    data-testid="manual-chat-panel"
                  >
                    {chat}
                  </motion.aside>
                )}
              </AnimatePresence>
            )}
          </LayoutGroup>
        </div>
        {phone && <RoadmapBottomBar hidden={split} />}
      </div>

      {phone && (
        <BottomSheet
          open={split}
          onClose={closeSplit}
          title={copy.chat.title}
          closeLabel={copy.closeAsk}
          full
        >
          <div className="ally-v2 manual-root h-[75vh]" data-testid="manual-chat-panel">
            {chat}
          </div>
        </BottomSheet>
      )}
      {compact && (
        <SidePanel
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          side="left"
          width="20rem"
          title={copy.tree.label}
          closeLabel={copy.chat.cancel}
        >
          <ManualDataContext.Provider value={data}>
            <div className="ally-v2 h-full">{rail}</div>
          </ManualDataContext.Provider>
        </SidePanel>
      )}

      <SearchPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenPage={openPage}
        onAsk={askFromPalette}
        recent={recent}
      />
      <ChangeLogPanel
        open={changes.open}
        slug={changes.slug}
        pageTitle={
          changes.slug ? (data.bySlug.get(changes.slug)?.title ?? pageDetail?.title) : null
        }
        onClose={() => setChanges(current => ({ ...current, open: false }))}
      />
      {manualState?.canAdminister && (
        <AdminDrawer open={adminOpen} onClose={() => setAdminOpen(false)} state={manualState} />
      )}
    </ManualDataContext.Provider>
  );
};
