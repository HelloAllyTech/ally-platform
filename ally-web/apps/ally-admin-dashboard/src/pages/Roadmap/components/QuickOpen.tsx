import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import { Close, Search } from "@icons";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { useSearchRoadmapQuery } from "@api";
import { ROUTES, en } from "@constants";
import type { RoadmapItemRow } from "@types";

import { dialogVariants, motionTransition, useReducedMotionPreference } from "../../../motion";
import { useDebouncedValue } from "../../ProductRoadmap/useDebouncedValue";
import { stageWord } from "../utils/copy";

type Entry =
  | { kind: "newIdea"; label: string }
  | { kind: "idea"; row: RoadmapItemRow }
  | { kind: "view"; view: string; label: string };

interface QuickOpenProps {
  open: boolean;
  onClose: () => void;
  onOpenIdea: (code: string) => void;
  onOpenView: (view: string) => void;
  views: string[];
  /** Phone: full screen (§4.17 "Search opens full screen"). */
  fullScreen: boolean;
}

/**
 * Quick open, ⌘K / Ctrl K (§4.11): jump to an idea by code, title or author, or to a view. With
 * nothing typed, it lists your last 5 ideas. Arrow keys move, Enter opens, Esc closes; focus returns
 * to where it was. "New idea" heads the list (and matches when typed).
 */
export const QuickOpen: React.FC<QuickOpenProps> = ({
  open,
  onClose,
  onOpenIdea,
  onOpenView,
  views,
  fullScreen,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.quickOpen;
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 150);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const navigate = useNavigate();

  const { data, isFetching } = useSearchRoadmapQuery(debounced.trim(), { skip: !open });

  const entries = useMemo<Entry[]>(() => {
    const q = debounced.trim().toLowerCase();
    const viewEntries: Entry[] = views
      .map(view => ({ kind: "view" as const, view, label: en.roadmapV2.views[view] }))
      .filter(entry => q && entry.label.toLowerCase().includes(q));
    const ideas = q ? data?.items : data?.recent;
    const ideaEntries: Entry[] = (Array.isArray(ideas) ? ideas : [])
      .slice(0, q ? 20 : 5)
      .map(row => ({ kind: "idea" as const, row }));
    const newIdeaLabel = en.roadmapV2.newIdea.button;
    const newIdea: Entry[] =
      !q || newIdeaLabel.toLowerCase().includes(q)
        ? [{ kind: "newIdea", label: newIdeaLabel }]
        : [];
    return [...newIdea, ...viewEntries, ...ideaEntries];
  }, [data, debounced, views]);

  useEffect(() => setHighlight(0), [debounced]);

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      openerRef.current?.focus?.();
    };
  }, [open]);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    if (entry.kind === "newIdea") navigate(ROUTES.ROADMAP_NEW_IDEA);
    else if (entry.kind === "idea") onOpenIdea(entry.row.code);
    else onOpenView(entry.view);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight(h => Math.min(entries.length - 1, h + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(entries[highlight]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  if (typeof document === "undefined") return null;

  const optionId = (index: number) => `${listId}-opt-${index}`;
  const q = debounced.trim();

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9060]" onKeyDown={onKeyDown}>
          <motion.div
            className="absolute inset-0 bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={{ opacity: 0 }}
            transition={motionTransition("fast", "productive", reduced)}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={copy.label}
            {...dialogVariants(reduced)}
            transition={motionTransition("fast", "productive", reduced)}
            className={
              fullScreen
                ? "absolute inset-0 flex flex-col bg-white"
                : "absolute left-1/2 top-[12vh] flex max-h-[70vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            }
            style={fullScreen ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
          >
            <div className="flex items-center gap-2 border-b border-border-light px-3">
              <Search size={18} className="text-typography-secondary" aria-hidden />
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={entries.length ? optionId(highlight) : undefined}
                aria-label={copy.placeholder}
                placeholder={copy.placeholder}
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
              />
              <button
                type="button"
                onClick={onClose}
                aria-label={copy.close}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-neutral-100"
              >
                <Close size={18} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-2">
              <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-typography-secondary">
                {q ? copy.results : copy.recent}
              </p>
              <ul
                id={listId}
                role="listbox"
                aria-label={q ? copy.results : copy.recent}
                className="m-0 list-none p-0"
              >
                {entries.map((entry, index) => {
                  const selected = index === highlight;
                  return (
                    <li
                      key={
                        entry.kind === "idea"
                          ? entry.row.code
                          : entry.kind === "view"
                            ? `view-${entry.view}`
                            : "new-idea"
                      }
                      id={optionId(index)}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(entry)}
                      className="relative flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-sm"
                    >
                      {selected && (
                        <motion.span
                          layoutId={reduced ? undefined : "roadmap-quick-open-highlight"}
                          className="absolute inset-0 bg-primary-50"
                          transition={motionTransition("fast", "productive", reduced)}
                          aria-hidden
                        />
                      )}
                      {entry.kind === "idea" ? (
                        <span className="relative flex min-w-0 flex-1 items-baseline gap-2">
                          <span className="shrink-0 text-xs tabular-nums text-typography-secondary">
                            {entry.row.code}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{entry.row.title}</span>
                          <span className="shrink-0 text-xs text-typography-secondary">
                            {stageWord(entry.row.stage ?? entry.row.shownStage)}
                          </span>
                        </span>
                      ) : entry.kind === "view" ? (
                        <span className="relative">
                          {copy.views}: {entry.label}
                        </span>
                      ) : (
                        <span className="relative font-semibold text-primary-700">
                          ＋ {entry.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!isFetching && entries.length === 0 && (
                <p className="px-4 py-3 text-sm text-typography-secondary">{copy.none}</p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
