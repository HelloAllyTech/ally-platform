import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Chat, Close, DockToRight, Maximize } from "@icons";
import { AnimatePresence, PanInfo, motion } from "framer-motion";
import { Link } from "react-router-dom";

import {
  Accordion,
  AccordionItem,
  Button,
  CarbonTabs,
  SidePanel,
  SkeletonText,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
} from "@ally-ui-mono/ui-shared";
import {
  useGetBuilderSessionQuery,
  useGetRoadmapItemQuery,
  useMarkRoadmapItemReadMutation,
} from "@api";
import { ROUTES, en } from "@constants";
import { useUser } from "@hooks";
import type { RoadmapItemDetail } from "@types";

import { BottomSheet } from "./BottomSheet";
import { Conversation } from "./Conversation";
import { IdeaBannerControls } from "./IdeaBannerControls";
import { CopyLinkButton, IdeaStar, IdeaTitle, IdeaVotes, PrimaryAction } from "./IdeaControls";
import { IdeaPanelContent } from "./IdeaPanels";
import { BANNER_TONE, HeaderTracker, OpportunityHeader } from "./OpportunityHeader";
import { PeopleChips } from "./PeopleChips";
import { PlanInterviewBar } from "./PlanInterviewBar";
import { RoadmapIconButton } from "./RoadmapIconButton";
import { ShippedCard } from "./ShippedCard";
import { Tracker } from "./Tracker";
import { motionTransition, paneVariants, useReducedMotionPreference } from "../../../motion";
import { DraftView } from "../drafts/DraftView";
import { RoadmapBreakpoint, sidePanelMode } from "../hooks/useRoadmapBreakpoint";
import { useRoadmapJobTimer } from "../hooks/useRoadmapJobTimer";
import { PresenceEntry } from "../hooks/useRoadmapRealtime";
import { useKeyboardInset } from "../hooks/useVisualViewport";
import { CommentBox } from "../session/CommentBox";
import { FirstSubmitNote } from "../session/FirstSubmitNote";
import { useSessionAnswers } from "../session/useSessionAnswers";
import {
  IDEA_PANEL_TABS,
  IdeaPanelTab,
  panelTabForStage,
  peopleLine,
  statusLine,
} from "../utils/copy";
import {
  PANEL_WIDTH,
  ROADMAP_PREF_KEYS,
  clampPanelWidth,
  readPref,
  writePref,
} from "../utils/prefs";

export type IdeaViewMode = "pane" | "page";

interface IdeaViewProps {
  code: string;
  mode: IdeaViewMode;
  breakpoint: RoadmapBreakpoint;
  presence?: PresenceEntry[];
  /** Pane: close the reading pane (Esc). */
  onClose?: () => void;
  /** Pane: ⤢ to the full page. */
  onOpenFull?: () => void;
  /** Where focus lands on open (§4.10: opening a row moves focus to the pane's title). */
  headingRef?: React.Ref<HTMLHeadingElement>;
}

const notFound = (error: unknown) => (error as { status?: unknown })?.status === 404;

/** Skeletons shaped like the page: header, tracker, three turns (§4.12). */
const IdeaSkeleton: React.FC = () => (
  <div className="flex flex-col gap-4 p-4" aria-busy="true">
    <SkeletonText heading width="60%" />
    <SkeletonText width="80%" />
    <SkeletonText paragraph lineCount={3} />
    <SkeletonText paragraph lineCount={3} />
  </div>
);

const Presence: React.FC<{ presence?: PresenceEntry[] }> = ({ presence }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.idea;
  const list = Array.isArray(presence) ? presence : [];
  const typing = list.find(p => p.kind === "typing");
  const viewers = Array.from(new Set(list.filter(p => p.kind === "viewing").map(p => p.name)));
  const line = typing
    ? copy.typing(typing.name)
    : viewers.length
      ? copy.viewing(viewers.join(", "))
      : "";
  return (
    <AnimatePresence>
      {line && (
        <motion.p
          key={line}
          className="m-0 text-xs text-typography-secondary"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition("fast", "productive", reduced)}
          aria-live="polite"
        >
          {line}
        </motion.p>
      )}
    </AnimatePresence>
  );
};

/**
 * The idea page (§4.5), and — with the side panel closed — the Queue's reading pane: the same
 * header and conversation in both, so an idea never looks two ways.
 *
 * Widths (§4.17): desktop puts the side panel beside the conversation (resizable, collapsible,
 * width remembered); laptop opens it as an overlay; tablet as a sheet; a phone shows Conversation
 * and Details as two tabs (swipe between them), Details as an accordion with the stage's section
 * open, and a sticky action bar that follows the keyboard and the safe area.
 */
export const IdeaView: React.FC<IdeaViewProps> = ({
  code,
  mode,
  breakpoint,
  presence,
  onClose,
  onOpenFull,
  headingRef,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  const { user } = useUser();
  const {
    data: item,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useGetRoadmapItemQuery(code);
  const sessionId = item?.sessionId;
  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
  } = useGetBuilderSessionQuery(sessionId ?? "", {
    skip: !sessionId,
    pollingInterval: 15_000,
    skipPollingIfUnfocused: true,
  });

  // Opening an idea marks it read (§4.3), once per idea.
  const [markRead] = useMarkRoadmapItemReadMutation();
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!item || markedRef.current === item.code) return;
    markedRef.current = item.code;
    // Always, not only when bold: opening also reads its notices, so a mention or a plan-ready
    // notice stops holding it in Needs you (idea-to-plan audit rec 8).
    void markRead(item.code);
  }, [item, markRead]);

  // P8: opening an idea you wrote ends "find where my idea is" (§4.16), if the Roadmap open
  // started it. Pane or page, the first one counts.
  const jobs = useRoadmapJobTimer();
  const authorId = item?.author?.id;
  useEffect(() => {
    if (!item || authorId === undefined || authorId !== user?.id) return;
    jobs.complete("find_my_idea", { itemId: item.code });
    // Once per idea shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.code, authorId, user?.id]);

  const [showAgentWork, setShowAgentWork] = useState<boolean>(() =>
    readPref(ROADMAP_PREF_KEYS.showAgentWork, false),
  );
  const onShowAgentWork = (on: boolean) => {
    setShowAgentWork(on);
    writePref(ROADMAP_PREF_KEYS.showAgentWork, on);
  };

  // The panel opens on the tab matching the stage, for each idea.
  const [tab, setTab] = useState<IdeaPanelTab>("summary");
  const tabFor = useRef<string | null>(null);
  useEffect(() => {
    if (!item || tabFor.current === item.code) return;
    tabFor.current = item.code;
    setTab(panelTabForStage(item.shownStage, item.statusParts));
  }, [item]);

  const [panelOpen, setPanelOpen] = useState<boolean>(() =>
    readPref(ROADMAP_PREF_KEYS.panelOpen, true),
  );
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    clampPanelWidth(readPref(ROADMAP_PREF_KEYS.panelWidth, PANEL_WIDTH.default)),
  );
  const [phoneTab, setPhoneTab] = useState<"conversation" | "details">("conversation");
  // The reading pane holds the whole idea: its conversation, and its details (Summary, Design,
  // Build ...) behind a switch, so nothing needs a second page. Null until chosen.
  const [paneView, setPaneView] = useState<"conversation" | IdeaPanelTab | null>(null);

  const setPanel = (open: boolean) => {
    setPanelOpen(open);
    writePref(ROADMAP_PREF_KEYS.panelOpen, open);
  };

  const panelMode = sidePanelMode(breakpoint);
  const openDetails = useCallback(
    (next?: IdeaPanelTab) => {
      if (next) setTab(next);
      if (mode === "pane") setPaneView(next ?? tab);
      else if (panelMode === "inline") setPanel(true);
      else if (panelMode === "tabs") setPhoneTab("details");
      else setOverlayOpen(true);
    },

    [panelMode, mode],
  );

  const keyboardInset = useKeyboardInset();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Resize the inline panel: pointer drag or arrow keys on the separator; the width is remembered.
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const onResizeStart = (event: React.PointerEvent) => {
    dragStart.current = { x: event.clientX, width: panelWidth };
    const move = (e: PointerEvent) => {
      if (!dragStart.current) return;
      setPanelWidth(clampPanelWidth(dragStart.current.width + (dragStart.current.x - e.clientX)));
    };
    const up = () => {
      dragStart.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPanelWidth(w => {
        writePref(ROADMAP_PREF_KEYS.panelWidth, w);
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onResizeKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = clampPanelWidth(panelWidth + (event.key === "ArrowLeft" ? step : -step));
    setPanelWidth(next);
    writePref(ROADMAP_PREF_KEYS.panelWidth, next);
  };

  const tabs = useMemo(
    () => IDEA_PANEL_TABS.map(key => ({ key, label: copy.idea.tabs[key] })),
    [copy.idea.tabs],
  );

  if (isLoading) return <IdeaSkeleton />;
  // Not an idea (yet): the contract says try it as one of your drafts (§4.2: the same page for life).
  if (isError && notFound(error)) {
    return <DraftView code={code} breakpoint={breakpoint} headingRef={headingRef} />;
  }
  if (isError || !item) {
    return (
      <div className="flex flex-col items-start gap-3 p-6" role="alert">
        <p className="text-sm text-typography-primary">
          {notFound(error) ? copy.itemNotFound : copy.itemLoadError}
        </p>
        {!notFound(error) && (
          <Button kind="tertiary" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {copy.retry}
          </Button>
        )}
      </div>
    );
  }

  const isPhone = breakpoint === "phone";
  const status = statusLine(item);
  const people = peopleLine(item);

  const tabbedPanel = (
    <CarbonTabs
      selectedIndex={Math.max(0, IDEA_PANEL_TABS.indexOf(tab))}
      onChange={({ selectedIndex }: { selectedIndex: number }) =>
        setTab(IDEA_PANEL_TABS[selectedIndex])
      }
    >
      <TabList aria-label={copy.idea.panel}>
        {tabs.map(t => (
          <Tab key={t.key}>{t.label}</Tab>
        ))}
      </TabList>
      <TabPanels>
        {tabs.map(t => (
          <TabPanel key={t.key} className="!px-0">
            {/* Only the selected tab mounts: Build polls its runs, and nothing hidden should. */}
            {t.key === tab && (
              <motion.div
                key={t.key}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={motionTransition("moderate", "productive", reduced)}
              >
                <IdeaPanelContent tab={t.key} item={item} session={session} />
              </motion.div>
            )}
          </TabPanel>
        ))}
      </TabPanels>
    </CarbonTabs>
  );

  const conversation = (
    <>
      <ShippedCard item={item} currentUserId={user?.id} />
      <Conversation
        item={item}
        messages={session?.messages}
        isLoading={!!sessionId && sessionLoading}
        isError={!!sessionId && sessionError}
        showAgentWork={showAgentWork}
        onShowAgentWorkChange={onShowAgentWork}
      />
    </>
  );

  const primary = (
    <>
      <PrimaryAction
        item={item}
        onApproveDesign={() => openDetails("design")}
        onOpenDetails={openDetails}
        fullWidth={isPhone}
        phone={isPhone}
      />
      <PlanInterviewBar item={item} fullWidth={isPhone} />
    </>
  );

  // ── header ──────────────────────────────────────────────────────────────────────────────────
  const header = isPhone ? (
    <PhoneHeader item={item} collapsed={collapsed} headingRef={headingRef} status={status} />
  ) : (
    <OpportunityHeader
      item={item}
      as={mode === "page" ? "h1" : "h2"}
      headingRef={headingRef}
      controls={<IdeaBannerControls item={item} />}
      actions={
        <>
          <IdeaVotes item={item} />
          <IdeaStar item={item} />
          <CopyLinkButton code={item.code} />
          {mode === "pane" && onOpenFull && (
            <RoadmapIconButton label={copy.openFullPage} onClick={onOpenFull}>
              <Maximize size={16} aria-hidden />
            </RoadmapIconButton>
          )}
          {mode === "pane" && onClose && (
            <RoadmapIconButton label={copy.closePane} onClick={onClose}>
              <Close size={16} aria-hidden />
            </RoadmapIconButton>
          )}
          {mode === "page" && panelMode === "inline" && !panelOpen && (
            <RoadmapIconButton label={copy.idea.panelExpand} onClick={() => setPanel(true)}>
              <DockToRight size={16} aria-hidden />
            </RoadmapIconButton>
          )}
        </>
      }
    >
      <HeaderTracker item={item} status={status} />
      <FirstSubmitNote code={item.code} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          {people && <PeopleChips item={item} />}
          <Presence presence={presence} />
        </div>
        <div className="flex items-center gap-2">
          {primary}
          {mode === "page" && panelMode !== "inline" && (
            <Button kind="ghost" size="sm" onClick={() => openDetails()}>
              {copy.idea.openDetails}
            </Button>
          )}
        </div>
      </div>
    </OpportunityHeader>
  );

  // ── reading pane ────────────────────────────────────────────────────────────────────────────
  if (mode === "pane") {
    // One row of tabs: Conversation, then the idea's own sections. An idea with no conversation yet
    // (a Backlog idea) opens on its Summary, the useful side.
    const shown = paneView ?? (item.sessionId ? "conversation" : tab);
    return (
      <motion.div
        key={item.code}
        className="flex h-full min-h-0 flex-col"
        {...paneVariants(reduced)}
        transition={motionTransition("moderate", "productive", reduced)}
      >
        {header}
        <div
          role="tablist"
          aria-label={copy.idea.panel}
          className="flex shrink-0 overflow-x-auto border-b border-border-light px-2"
        >
          {(["conversation", ...IDEA_PANEL_TABS] as const).map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={shown === key}
              onClick={() => {
                setPaneView(key);
                if (key !== "conversation") setTab(key);
              }}
              className={`relative min-h-10 shrink-0 px-4 text-sm ${
                shown === key
                  ? "font-semibold text-typography-primary"
                  : "text-typography-secondary hover:bg-neutral-100 hover:text-typography-primary"
              }`}
            >
              {key === "conversation" ? copy.idea.conversation : copy.idea.tabs[key]}
              {shown === key && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary-500" aria-hidden />
              )}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {shown === "conversation" ? (
            conversation
          ) : (
            <IdeaPanelContent tab={shown} item={item} session={session} />
          )}
        </div>
      </motion.div>
    );
  }

  // ── phone ───────────────────────────────────────────────────────────────────────────────────
  if (isPhone) {
    const onSwipe = (_e: unknown, info: PanInfo) => {
      if (Math.abs(info.offset.x) < 80 || Math.abs(info.offset.y) > Math.abs(info.offset.x)) return;
      setPhoneTab(info.offset.x < 0 ? "details" : "conversation");
    };
    const stageTab = panelTabForStage(item.shownStage, item.statusParts);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={event => setCollapsed((event.currentTarget as HTMLDivElement).scrollTop > 40)}
        >
          {header}
          <div
            role="tablist"
            aria-label={copy.idea.panel}
            className="sticky top-12 z-[2] flex border-b border-border-light bg-white"
          >
            {(["conversation", "details"] as const).map(key => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={phoneTab === key}
                onClick={() => setPhoneTab(key)}
                className={`relative min-h-11 flex-1 text-sm ${
                  phoneTab === key
                    ? "font-semibold text-typography-primary"
                    : "text-typography-secondary"
                }`}
              >
                {key === "conversation" ? copy.idea.conversation : copy.idea.details}
                {phoneTab === key && (
                  <motion.span
                    layoutId={reduced ? undefined : "roadmap-phone-tab"}
                    className="absolute inset-x-4 bottom-0 h-0.5 bg-primary-600"
                    transition={motionTransition("moderate", "productive", reduced)}
                  />
                )}
              </button>
            ))}
          </div>
          <motion.div
            className="px-4 py-3"
            drag={reduced ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.15}
            dragDirectionLock
            onDragEnd={onSwipe}
          >
            {phoneTab === "conversation" ? (
              conversation
            ) : (
              <Accordion>
                {tabs.map(t => (
                  <AccordionItem key={t.key} title={t.label} open={t.key === stageTab}>
                    <IdeaPanelContent tab={t.key} item={item} session={session} />
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </motion.div>
          {/* Room for the sticky bar. */}
          <div className="h-24" aria-hidden />
        </div>
        {/* Sticky action bar: 💬 opens the comment sheet (mic, @mentions), and the one primary
            action at full width, or the quiet line. It follows the keyboard and keeps clear of the
            home indicator. */}
        <div
          className="fixed inset-x-0 z-[20] flex items-center gap-3 border-t border-border-light bg-white px-4 py-2"
          style={{
            bottom: keyboardInset,
            paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
          }}
        >
          <PhoneCommentButton item={item} />
          <div className="min-w-0 flex-1">{primary}</div>
        </div>
      </div>
    );
  }

  // ── tablet, laptop, desktop page ────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1">
        <motion.div
          layout={reduced ? false : "size"}
          className="min-w-0 flex-1 overflow-y-auto px-4 py-3"
        >
          {conversation}
        </motion.div>
        {panelMode === "inline" && (
          <AnimatePresence initial={false}>
            {panelOpen && (
              <motion.aside
                key="panel"
                aria-label={copy.idea.panel}
                className="relative flex shrink-0 flex-col border-l border-border-light"
                style={{ width: panelWidth }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                transition={motionTransition("slow", "productive", reduced)}
              >
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={copy.idea.panel}
                  aria-valuemin={PANEL_WIDTH.min}
                  aria-valuemax={PANEL_WIDTH.max}
                  aria-valuenow={panelWidth}
                  tabIndex={0}
                  onPointerDown={onResizeStart}
                  onKeyDown={onResizeKey}
                  className="absolute inset-y-0 -left-1 z-[1] w-2 cursor-col-resize focus-visible:bg-primary-200"
                />
                <div className="flex items-center justify-end px-2 pt-1">
                  <RoadmapIconButton
                    label={copy.idea.panelCollapse}
                    onClick={() => setPanel(false)}
                  >
                    <Close size={16} aria-hidden />
                  </RoadmapIconButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{tabbedPanel}</div>
              </motion.aside>
            )}
          </AnimatePresence>
        )}
      </div>
      {panelMode === "overlay" && (
        <SidePanel
          open={overlayOpen}
          onClose={() => setOverlayOpen(false)}
          title={copy.idea.panel}
          closeLabel={copy.idea.panelCollapse}
          width={`${panelWidth}px`}
        >
          {tabbedPanel}
        </SidePanel>
      )}
      {panelMode === "sheet" && (
        <BottomSheet
          open={overlayOpen}
          onClose={() => setOverlayOpen(false)}
          title={copy.idea.panel}
          closeLabel={copy.idea.panelCollapse}
          full
        >
          {tabbedPanel}
        </BottomSheet>
      )}
    </div>
  );
};

/**
 * The phone header (§4.17): ‹ Queue, votes, star, ⋯; code and title; a 5-segment tracker with the
 * stage word. As you scroll, the title moves into the top bar (in full, wrapped) and the tracker
 * thins to a line.
 */
const PhoneHeader: React.FC<{
  item: RoadmapItemDetail;
  collapsed: boolean;
  status: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
}> = ({ item, collapsed, status, headingRef }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  return (
    <header className="flex flex-col">
      <div
        className={`sticky top-0 z-[3] flex min-h-12 items-start gap-1 border-b px-1 ${
          BANNER_TONE[item.stage ?? "draft"] ?? BANNER_TONE.draft
        }`}
      >
        <Link
          to={ROUTES.ROADMAP}
          className="inline-flex h-12 shrink-0 items-center px-2 text-sm text-primary-700"
          aria-label={copy.actions.back}
        >
          ‹ {copy.backToQueue}
        </Link>
        {/* The grounding strip: code and stage at every scroll position and in every tab. The title
            is always on screen in full: in the body below until you scroll past it, then here,
            wrapped — never cut to one line (2026-11-19). */}
        <div className="flex min-h-12 min-w-0 flex-1 flex-col justify-center py-1">
          <span className="text-xs tabular-nums leading-tight text-typography-secondary">
            {item.code} · {copy.stages[item.stage ?? item.shownStage]}
          </span>
          {collapsed && (
            <span className="break-words text-sm font-semibold leading-snug text-typography-primary">
              {item.title}
            </span>
          )}
        </div>
        <IdeaStar item={item} compact />
        <CopyLinkButton code={item.code} compact />
      </div>
      <div className="flex flex-col gap-2 px-4 pb-3 pt-2">
        <span className="text-xs tabular-nums text-typography-secondary">{item.code}</span>
        <motion.div
          style={{ originX: 0 }}
          animate={reduced ? { opacity: collapsed ? 0.6 : 1 } : { scale: collapsed ? 0.8 : 1 }}
          transition={motionTransition("fast", "productive", reduced)}
        >
          <IdeaTitle
            item={item}
            as="h1"
            headingRef={headingRef}
            className="text-xl font-semibold text-typography-primary"
          />
        </motion.div>
        <Tracker stage={item.stage ?? item.shownStage} compact />
        <p className="m-0 text-sm text-typography-secondary">
          {copy.stages[item.stage ?? item.shownStage]} · {status}
        </p>
        <IdeaBannerControls item={item} />
        <div className="flex items-center gap-2">
          <IdeaVotes item={item} />
        </div>
      </div>
    </header>
  );
};

/** The phone's 💬: the comment sheet, with the 56 px mic and @mentions (§4.17). */
const PhoneCommentButton: React.FC<{ item: RoadmapItemDetail }> = ({ item }) => {
  const copy = en.roadmapV2.session;
  const session = useSessionAnswers(item);
  const [open, setOpen] = useState(false);
  if (!item.can?.comment) return null;
  // An older idea with no conversation yet: the sheet's box offers to open one.
  if (!session.enabled && item.sessionId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy.commentOpen}
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border-light"
      >
        <Chat size={20} aria-hidden />
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={copy.commentSheet}
        closeLabel={en.roadmapV2.mobile.close}
      >
        <CommentBox item={item} session={session} large autoFocus onSent={() => setOpen(false)} />
      </BottomSheet>
    </>
  );
};
