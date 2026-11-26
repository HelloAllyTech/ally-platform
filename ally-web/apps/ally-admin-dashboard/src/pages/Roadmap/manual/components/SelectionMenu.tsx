import React, { useEffect } from "react";

import { Chat, Idea } from "@carbon/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";

import { en } from "@constants";

import { motionTransition, popVariants, useReducedMotionPreference } from "../../../../motion";

import type { ManualSelection } from "../hooks/useSelectionMenu";

const MENU_WIDTH = 300;
const MENU_HEIGHT = 40;

/** Where the menu sits: centred above the selection, below it when there's no room, on screen. */
export const menuPosition = (
  rect: ManualSelection["rect"],
  viewportWidth: number,
): { top: number; left: number } => {
  const above = rect.top - MENU_HEIGHT - 8;
  const top = above > 8 ? above : rect.top + rect.height + 8;
  const centred = rect.left + rect.width / 2 - MENU_WIDTH / 2;
  const left = Math.max(8, Math.min(centred, viewportWidth - MENU_WIDTH - 8));
  return { top, left };
};

/**
 * The small menu that floats over selected text in a page: Ask about this · Start a draft idea.
 * Mouse-first; the page header's overflow menu carries the same two actions for the keyboard.
 */
export const SelectionMenu: React.FC<{
  selection: ManualSelection | null;
  onAsk: () => void;
  onDraft: () => void;
  onClose: () => void;
}> = ({ selection, onAsk, onDraft, onClose }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.productManual.selection;

  useEffect(() => {
    if (!selection) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection, onClose]);

  if (typeof document === "undefined") return null;
  const position = selection
    ? menuPosition(selection.rect, window.innerWidth || 1024)
    : { top: 0, left: 0 };
  const button =
    "flex h-8 items-center gap-1.5 px-3 text-sm text-white hover:bg-white/10 focus-visible:bg-white/10";

  return createPortal(
    <AnimatePresence>
      {selection && (
        <motion.div
          key="manual-selection-menu"
          role="toolbar"
          aria-label={copy.label}
          className="ally-v2 fixed z-[9200] flex items-center bg-neutral-900 shadow-lg"
          style={{ top: position.top, left: position.left }}
          variants={popVariants(reduced)}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={motionTransition("fast", "productive", reduced)}
          // Keep the selection: a mousedown here would otherwise collapse it before the click lands.
          onMouseDown={event => event.preventDefault()}
        >
          <button type="button" className={button} onClick={onAsk}>
            <Chat size={14} aria-hidden />
            {copy.ask}
          </button>
          <span className="h-5 w-px bg-white/20" aria-hidden />
          <button type="button" className={button} onClick={onDraft}>
            <Idea size={14} aria-hidden />
            {copy.draft}
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
