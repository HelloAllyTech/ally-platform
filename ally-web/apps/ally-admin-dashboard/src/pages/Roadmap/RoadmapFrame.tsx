import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { Close } from "@icons";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";

import { Button, Modal } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { motionTransition, useReducedMotionPreference } from "../../motion";
import { RoadmapIconButton } from "./components/RoadmapIconButton";
import { RoadmapTopNav } from "./components/RoadmapTopNav";
import { useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { useRoadmapPresence } from "./hooks/useRoadmapJobTimer";
import {
  ROADMAP_STORE_KEYS,
  readStore,
  recordVisit,
  shouldIntroduceShortcuts,
  writeStore,
} from "./utils/localStore";
import { MovedState, movedStateOf } from "./utils/redirects";

interface RoadmapFrameValue {
  /** ? → What moved (§4.15). */
  openWhatMoved: () => void;
}

const RoadmapFrameContext = createContext<RoadmapFrameValue>({ openWhatMoved: () => undefined });

export const useRoadmapFrame = (): RoadmapFrameValue => useContext(RoadmapFrameContext);

/** "Builder is now Roadmap → For you", for a page an old link landed on (§4.15). */
export const MovedBanner: React.FC<{ moved: MovedState; onDismiss: () => void }> = ({
  moved,
  onDismiss,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2Tools.moved;
  return (
    <motion.div
      role="status"
      className="flex items-center gap-2 border-b border-primary-200 bg-primary-50 px-4 py-2 text-sm text-typography-900"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={motionTransition("moderate", "productive", reduced)}
    >
      <span className="min-w-0 flex-1">
        {copy.banner(copy.from[moved.from] ?? moved.from, copy.landed[moved.landed] ?? "")}
      </span>
      <RoadmapIconButton label={copy.dismiss} onClick={onDismiss} large>
        <Close size={16} aria-hidden />
      </RoadmapIconButton>
    </motion.div>
  );
};

/** The one-time What moved panel: four lines, dismissible, reopened from ? → What moved. */
export const WhatMovedDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const copy = en.roadmapV2Tools.moved;
  return (
    <Modal
      open={open}
      size="sm"
      modalHeading={copy.whatMovedTitle}
      primaryButtonText={copy.gotIt}
      onRequestClose={onClose}
      onRequestSubmit={onClose}
    >
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-sm text-typography-900">
        {copy.whatMovedLines.map(line => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-typography-600">{copy.whatMovedLater}</p>
    </Modal>
  );
};

/** Ask the Queue to open its shortcuts list, the same way pressing ? does. */
export const requestShortcuts = (): void => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
};

/**
 * Wraps every Roadmap page: the banner an old link lands with, the one-time What moved panel on
 * the first visit, and — progressively, after the third visit, on a keyboard-sized screen — one
 * line introducing the shortcuts (§4.15) [FP-1228, FP-1227].
 */
export const RoadmapFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // P8: tells the job timer someone is inside the Roadmap ("Roadmap open" for find_my_idea).
  useRoadmapPresence();
  const location = useLocation();
  const navigate = useNavigate();
  const breakpoint = useRoadmapBreakpoint();
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2Tools.moved;

  const [moved, setMoved] = useState<MovedState | null>(() => movedStateOf(location.state));
  useEffect(() => {
    const next = movedStateOf(location.state);
    if (next) setMoved(next);
  }, [location.state]);
  const dismissMoved = () => {
    setMoved(null);
    // Drop the state so Back/refresh doesn't bring the banner back.
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  };

  const [whatMovedOpen, setWhatMovedOpen] = useState(false);
  const [shortcutsTip, setShortcutsTip] = useState(false);
  useEffect(() => {
    const visits = recordVisit();
    if (!readStore<boolean>(ROADMAP_STORE_KEYS.whatMovedSeen, false)) {
      setWhatMovedOpen(true);
      return;
    }
    const introduced = readStore<boolean>(ROADMAP_STORE_KEYS.shortcutsIntroduced, false);
    if (shouldIntroduceShortcuts(visits, introduced)) setShortcutsTip(true);
  }, []);

  const closeWhatMoved = () => {
    setWhatMovedOpen(false);
    writeStore(ROADMAP_STORE_KEYS.whatMovedSeen, true);
  };
  const closeTip = () => {
    setShortcutsTip(false);
    writeStore(ROADMAP_STORE_KEYS.shortcutsIntroduced, true);
  };

  const openWhatMoved = useCallback(() => setWhatMovedOpen(true), []);
  // Shortcuts need a keyboard: phones and tablets never get the tip.
  const showTip = shortcutsTip && breakpoint !== "phone" && breakpoint !== "tablet";

  return (
    <RoadmapFrameContext.Provider value={{ openWhatMoved }}>
      <div className="flex h-full min-h-0 flex-col">
        {/* The sub navigation of the Roadmap lives here, once, above every page: it never remounts
            or moves as you go from one to another, and banners sit beneath it. A phone's pages
            draw their own title bar instead. */}
        {breakpoint !== "phone" && <RoadmapTopNav phone={false} withNewIdea />}
        <AnimatePresence initial={false}>
          {moved && <MovedBanner key="moved" moved={moved} onDismiss={dismissMoved} />}
          {showTip && (
            <motion.div
              key="tip"
              role="status"
              className="flex items-center gap-3 border-b border-border-light bg-neutral-50 px-4 py-2 text-sm text-typography-900"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={motionTransition("moderate", "productive", reduced)}
            >
              <span className="min-w-0 flex-1">{copy.shortcutsIntro}</span>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => {
                  closeTip();
                  requestShortcuts();
                }}
              >
                {copy.shortcutsShow}
              </Button>
              <RoadmapIconButton label={copy.dismiss} onClick={closeTip}>
                <Close size={16} aria-hidden />
              </RoadmapIconButton>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      <WhatMovedDialog open={whatMovedOpen} onClose={closeWhatMoved} />
    </RoadmapFrameContext.Provider>
  );
};
