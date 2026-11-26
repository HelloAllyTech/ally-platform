import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import { Chat, Search, Time } from "@carbon/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";

import { useSearchManualQuery } from "@api";
import { en } from "@constants";
import type { ManualPageRef, ManualSearchHit } from "@types";

import { motionTransition, useReducedMotionPreference } from "../../../../motion";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { parseSnippet } from "../utils/snippet";

export const SEARCH_DEBOUNCE_MS = 150;
const MIN_QUERY = 2;

/** A snippet with `<mark>` highlights, rendered as text and `<mark>` elements only. */
export const Snippet: React.FC<{ html: string }> = ({ html }) => (
  <>
    {parseSnippet(html).map((part, index) =>
      part.mark ? (
        <mark key={index} className="manual-mark">
          {part.text}
        </mark>
      ) : (
        <React.Fragment key={index}>{part.text}</React.Fragment>
      ),
    )}
  </>
);

type Row =
  | { kind: "hit"; hit: ManualSearchHit }
  | { kind: "recent"; page: ManualPageRef }
  | { kind: "ask"; query: string };

export interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenPage: (slug: string) => void;
  onAsk: (query: string) => void;
  recent: ManualPageRef[];
}

/**
 * ⌘K for the manual: a centred palette over the page. Typing searches after a 150 ms pause; an
 * empty box shows what you read recently. The last row always offers to ask the manual instead,
 * with what you typed. Arrows move, Enter opens, Escape closes; focus stays in the palette while
 * it is open and goes back where it came from when it closes.
 */
export const SearchPalette: React.FC<SearchPaletteProps> = ({
  open,
  onClose,
  onOpenPage,
  onAsk,
  recent,
}) => {
  const copy = en.productManual.palette;
  const reduced = useReducedMotionPreference();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const searching = debounced.length >= MIN_QUERY;
  const {
    data: hits,
    isFetching,
    isError,
  } = useSearchManualQuery({ q: debounced }, { skip: !open || !searching });

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      openerRef.current?.focus?.();
    };
  }, [open]);

  const typed = query.trim();
  const rows: Row[] = useMemo(() => {
    const list: Row[] = searching
      ? (hits ?? []).map(hit => ({ kind: "hit" as const, hit }))
      : typed.length === 0
        ? recent.map(page => ({ kind: "recent" as const, page }))
        : [];
    return [...list, { kind: "ask" as const, query: typed }];
  }, [searching, hits, recent, typed]);

  useEffect(() => setActive(0), [debounced]);
  const current = Math.min(active, rows.length - 1);

  const choose = (row: Row) => {
    if (row.kind === "ask") onAsk(row.query);
    else onOpenPage(row.kind === "hit" ? row.hit.slug : row.page.slug);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[current];
      if (row) choose(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      // The input is the palette's only tab stop: keep focus inside.
      event.preventDefault();
    }
  };

  const status = searching
    ? isError
      ? copy.failed
      : isFetching && !hits
        ? copy.searching
        : hits && hits.length === 0
          ? copy.noResults
          : null
    : typed.length === 0 && recent.length === 0
      ? copy.noRecent
      : null;

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="manual-palette"
          className="ally-v2 fixed inset-0 z-[9300] flex items-start justify-center bg-black/30 px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition("fast", "productive", reduced)}
          onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={copy.label}
            className="flex w-full max-w-xl flex-col overflow-hidden border border-border-light bg-white shadow-2xl"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            // ≤ 160 ms in and out.
            transition={
              reduced
                ? motionTransition("fast", "productive", true)
                : { duration: 0.16, ease: [0.2, 0, 0.38, 0.9] }
            }
          >
            <div className="flex items-center gap-2 border-b border-border-light px-4">
              <Search size={18} aria-hidden className="text-typography-500" />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={rows.length ? optionId(current) : undefined}
                aria-label={copy.placeholder}
                placeholder={copy.placeholder}
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                className="h-14 min-w-0 flex-1 border-0 bg-transparent text-lg text-typography-900 outline-none placeholder:text-typography-500"
              />
            </div>
            <div className="max-h-[55vh] overflow-y-auto py-1">
              {!searching && typed.length === 0 && recent.length > 0 && (
                <p className="m-0 px-4 pb-1 pt-2 text-xs font-semibold text-typography-600">
                  {copy.recent}
                </p>
              )}
              {status && (
                <p role="status" className="m-0 px-4 py-2 text-sm text-typography-600">
                  {status}
                </p>
              )}
              <ul
                id={listId}
                role="listbox"
                aria-label={copy.results}
                className="m-0 list-none p-0"
              >
                {rows.map((row, index) => {
                  const selected = index === current;
                  const base = `flex cursor-pointer gap-3 px-4 py-2.5 ${
                    selected ? "bg-primary-50" : "hover:bg-neutral-50"
                  }`;
                  return (
                    <li
                      key={
                        row.kind === "hit"
                          ? `hit-${row.hit.slug}`
                          : row.kind === "recent"
                            ? `recent-${row.page.slug}`
                            : "ask"
                      }
                      id={optionId(index)}
                      role="option"
                      aria-selected={selected}
                      className={`${base} ${row.kind === "ask" ? "border-t border-border-light" : ""}`}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => choose(row)}
                    >
                      {row.kind === "hit" && (
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm text-typography-900">
                            {row.hit.parentTitle && (
                              <span className="text-typography-500">{row.hit.parentTitle} / </span>
                            )}
                            <span className="font-semibold">{row.hit.title}</span>
                          </span>
                          {row.hit.snippet && (
                            <span className="line-clamp-2 text-xs leading-relaxed text-typography-600">
                              <Snippet html={row.hit.snippet} />
                            </span>
                          )}
                        </span>
                      )}
                      {row.kind === "recent" && (
                        <span className="flex items-center gap-2 text-sm text-typography-900">
                          <Time size={14} aria-hidden className="text-typography-500" />
                          {row.page.title}
                        </span>
                      )}
                      {row.kind === "ask" && (
                        <span className="flex items-center gap-2 text-sm text-primary-700">
                          <Chat size={14} aria-hidden />
                          {row.query ? copy.ask(row.query) : copy.askEmpty}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="m-0 border-t border-border-light px-4 py-2 text-xs text-typography-500">
              {copy.hint}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
