import React, { useEffect, useRef, useState } from "react";

import { Notification, StarSolid } from "@icons";
import { AnimatePresence, PanInfo, motion, useAnimationControls } from "framer-motion";

import { Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { RoadmapItemRow } from "@types";

import { STAGE_TAG } from "./OpportunityHeader";
import {
  haptic,
  motionTransition,
  springTransition,
  useReducedMotionPreference,
} from "../../../motion";
import { simpleStageOfShown, stageWord, whyHereLine } from "../utils/copy";

export interface QueueRowActions {
  onOpen: (code: string) => void;
  onMarkRead: (code: string) => void;
  onWatch: (code: string) => void;
  /** Long-press on touch: the action sheet (open, watch, copy link). */
  onLongPress?: (code: string) => void;
  /** Hovered or focused for 150 ms: prefetch the reading pane (§4.12). */
  onPrefetch?: (code: string) => void;
}

interface QueueRowProps extends QueueRowActions {
  row: RoadmapItemRow;
  selected: boolean;
  /** Left the view while the list was held: shown faded until released (§4.12). */
  gone?: boolean;
  /** Phone and tablet: swipe-reveal and long-press are on. */
  touch: boolean;
  /** Every Roadmap role may vote (§3.1); false only where the caller has none. */
  index: number;
}

const REVEAL_LEFT = -132;
const REVEAL_RIGHT = 96;
const SNAP_THRESHOLD = 56;
const LONG_PRESS_MS = 500;
const PREFETCH_DELAY_MS = 150;

/**
 * One row of the Queue (§4.3): code, title, stage word and the one line saying why it's here, votes
 * and star on the right. Bold with a dot = changed since you last opened it, and the open button's
 * name says "Unread" too, so the state is never carried by weight alone.
 *
 * On touch, a swipe only REVEALS actions — left: Mark read; right: Watch — and every one of them is
 * also in the row's ⋯ menu (§4.17). The row is a plain list item with one named button, never a
 * `role="button"` row, so screen readers keep the list semantics.
 */
export const QueueRow: React.FC<QueueRowProps> = ({
  row,
  selected,
  gone = false,
  touch,
  index,
  onOpen,
  onMarkRead,
  onWatch,
  onLongPress,
  onPrefetch,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  const controls = useAnimationControls();
  const [revealed, setRevealed] = useState<"none" | "left" | "right">("none");
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(
    () => () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
    [],
  );

  const month = row.plannedMonth
    ? (() => {
        const [y, mo] = row.plannedMonth.split("-").map(Number);
        return y && mo
          ? new Date(y, mo - 1, 1).toLocaleString("en", { month: "short", year: "numeric" })
          : row.plannedMonth;
      })()
    : null;
  const facts = [
    row.goal?.name,
    row.lead ? `Lead: ${row.lead.name}` : row.stage === "being_built" ? "No lead" : null,
    month ? `Planned ${month}` : null,
    row.author?.name ? `Wrote it: ${row.author.name}` : null,
  ].filter((v): v is string => !!v);

  const why = whyHereLine(row.whyHere);

  const schedulePrefetch = () => {
    if (!onPrefetch) return;
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = setTimeout(() => onPrefetch(row.code), PREFETCH_DELAY_MS);
  };
  const cancelPrefetch = () => {
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = null;
  };

  const snapTo = (where: "none" | "left" | "right") => {
    setRevealed(where);
    void controls.start({
      x: where === "left" ? REVEAL_LEFT : where === "right" ? REVEAL_RIGHT : 0,
      transition: springTransition(reduced),
    });
  };

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.x < -SNAP_THRESHOLD) snapTo("left");
    else if (info.offset.x > SNAP_THRESHOLD) snapTo("right");
    else snapTo("none");
  };

  const startLongPress = () => {
    if (!touch || !onLongPress) return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      haptic(10);
      onLongPress(row.code);
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const act = (fn: (code: string) => void) => () => {
    fn(row.code);
    snapTo("none");
  };

  const openLabel = row.unread
    ? copy.row.openUnread(row.code, row.title)
    : copy.row.open(row.code, row.title);

  return (
    <motion.li
      layout={reduced ? false : "position"}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: gone ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{
        ...motionTransition("moderate", "productive", reduced),
        delay: reduced || index >= 8 ? 0 : index * 0.03,
      }}
      className="relative list-none overflow-hidden border-b border-border-light"
      data-code={row.code}
      data-selected={selected || undefined}
    >
      {touch && (
        <>
          {/* Revealed by a swipe right. */}
          <div
            className="absolute inset-y-0 left-0 flex items-center"
            aria-hidden={revealed !== "right"}
          >
            <button
              type="button"
              tabIndex={revealed === "right" ? 0 : -1}
              onClick={act(onWatch)}
              className="flex h-full w-24 flex-col items-center justify-center gap-1 bg-primary-600 text-sm text-white"
            >
              <Notification size={20} aria-hidden />
              {copy.row.watch}
            </button>
          </div>
          {/* Revealed by a swipe left. */}
          <div
            className="absolute inset-y-0 right-0 flex items-center"
            aria-hidden={revealed !== "left"}
          >
            <button
              type="button"
              tabIndex={revealed === "left" ? 0 : -1}
              onClick={act(onMarkRead)}
              className="flex h-full w-[132px] flex-col items-center justify-center gap-1 bg-neutral-700 text-sm text-white"
            >
              {copy.row.markRead}
            </button>
          </div>
        </>
      )}

      <motion.div
        animate={controls}
        drag={touch && !reduced ? "x" : false}
        dragConstraints={{ left: REVEAL_LEFT, right: REVEAL_RIGHT }}
        dragElastic={0.1}
        dragDirectionLock
        onDragStart={cancelLongPress}
        onDragEnd={onDragEnd}
        className={`relative flex items-stretch bg-white ${touch ? "min-h-[72px]" : "min-h-12"}`}
      >
        {/* The selected background tints in from the left (§4.18 "Select a row"). */}
        <AnimatePresence>
          {selected && (
            <motion.span
              className="pointer-events-none absolute inset-0 origin-left bg-primary-50"
              initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
              animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
              exit={{ opacity: 0 }}
              transition={motionTransition("moderate", "productive", reduced)}
              aria-hidden
            />
          )}
        </AnimatePresence>

        <span className="relative flex w-6 shrink-0 items-start justify-center pt-4" aria-hidden>
          <AnimatePresence>
            {row.unread && (
              <motion.span
                className="block h-2 w-2 rounded-full bg-primary-600"
                initial={{ scale: 1 }}
                exit={reduced ? { opacity: 0 } : { scale: 0 }}
                transition={motionTransition("fast", "productive", reduced)}
              />
            )}
          </AnimatePresence>
        </span>

        <button
          type="button"
          aria-label={openLabel}
          aria-current={selected ? "true" : undefined}
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            if (revealed !== "none") {
              snapTo("none");
              return;
            }
            onOpen(row.code);
          }}
          onFocus={schedulePrefetch}
          onBlur={cancelPrefetch}
          onPointerEnter={event => {
            if (event.pointerType !== "touch" && event.pointerType !== "pen") schedulePrefetch();
          }}
          onPointerLeave={cancelPrefetch}
          onTouchStart={startLongPress}
          onTouchEnd={cancelLongPress}
          onTouchMove={cancelLongPress}
          className="relative min-w-0 flex-1 py-3 pr-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          {/* Line 1: where it stands. Line 2: the title, in full up to two lines. Line 3: what it is
              about and who has it, so a row can be read before it is opened. */}
          <span className="flex min-w-0 items-center gap-2">
            {typeof row.queueRank === "number" && (
              <span
                className="shrink-0 text-xs font-semibold tabular-nums text-primary-700"
                title={copy.row.rankHelp(row.queueRank)}
                data-testid="queue-rank"
              >
                <span aria-hidden>#{row.queueRank}</span>
                <span className="sr-only">{copy.row.rankLabel(row.queueRank)}</span>
              </span>
            )}
            <span className="shrink-0 text-xs tabular-nums text-typography-secondary">
              {row.code}
            </span>
            <Tag
              type={STAGE_TAG[row.stage ?? simpleStageOfShown(row.shownStage)] ?? "gray"}
              size="sm"
              className="!m-0 shrink-0"
            >
              {stageWord(row.stage ?? row.shownStage)}
            </Tag>
            {row.starred && (
              <span
                title={row.starredBy ? copy.people.starredBy(row.starredBy.name) : copy.row.starred}
              >
                <StarSolid size={14} className="text-warning-500" aria-hidden />
                <span className="sr-only">{copy.row.starred}</span>
              </span>
            )}
          </span>
          <span
            className={`mt-1 line-clamp-2 block break-words text-base leading-snug ${
              row.unread ? "font-semibold text-typography-primary" : "text-typography-primary"
            }`}
            title={row.title}
          >
            {row.title}
          </span>
          {facts.length > 0 && (
            <span
              className="mt-1 block truncate text-xs text-typography-secondary"
              title={facts.join(" · ")}
            >
              {facts.join(" · ")}
            </span>
          )}
          {why && (
            <span className="mt-0.5 block truncate text-xs text-typography-secondary" title={why}>
              {why}
            </span>
          )}
        </button>
      </motion.div>
    </motion.li>
  );
};
