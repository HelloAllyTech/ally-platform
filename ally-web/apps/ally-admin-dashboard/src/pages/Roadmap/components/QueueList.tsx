import React, { useEffect, useMemo, useRef, useState } from "react";

import { Refresh, Tick } from "@icons";
import { AnimatePresence, motion } from "framer-motion";

import { Button, SkeletonText } from "@ally-ui-mono/ui-shared";
import { rowsOfItemsResponse } from "@api";
import { en } from "@constants";
import type {
  RoadmapItemRow,
  RoadmapItemsResponse,
  RoadmapQueueView,
  RoadmapSimpleStage,
} from "@types";

import { NewIdeaButton } from "./NewIdeaButton";
import { QueueRow, QueueRowActions } from "./QueueRow";
import { motionTransition, popVariants, useReducedMotionPreference } from "../../../motion";
import { simpleStageOfShown } from "../utils/copy";
import { DisplayRow, freezeOrder, liveRows } from "../utils/frozenOrder";

/** A titled group of rows. `key` doubles as the copy key in en.roadmapV2.sections / stages. */
export interface QueueSection {
  key: string;
  label?: string;
  rows: RoadmapItemRow[];
}

const FOR_YOU_SECTIONS = ["needsYou", "yourIdeas", "recentlyShipped"];
const TRIAGE_SECTIONS = ["backlog"];
const LEADING_STAGE_ORDER: RoadmapSimpleStage[] = ["being_built", "shipped", "backlog", "declined"];

/**
 * The response as sections (§4.3): For you and To triage come in the server's own sections, in a
 * fixed order; Leading is grouped by stage here; All ideas is one unnamed list.
 */
export const sectionsFor = (
  view: RoadmapQueueView,
  response: RoadmapItemsResponse | undefined,
): QueueSection[] => {
  if (!response) return [];
  const copy = en.roadmapV2;
  if ("sections" in response && response.sections) {
    const raw = response.sections as Record<string, unknown>;
    const order = view === "to-triage" ? TRIAGE_SECTIONS : FOR_YOU_SECTIONS;
    const known = order.filter(key => key in raw);
    const extra = Object.keys(raw).filter(key => !order.includes(key));
    return [...known, ...extra].map(key => ({
      key,
      label: copy.sections[key] ?? key,
      rows: Array.isArray(raw[key]) ? (raw[key] as RoadmapItemRow[]) : [],
    }));
  }
  const rows = rowsOfItemsResponse(response);
  if (view === "leading") {
    return LEADING_STAGE_ORDER.map(stage => ({
      key: stage,
      label: copy.stages[stage],
      rows: rows.filter(row => (row.stage ?? simpleStageOfShown(row.shownStage)) === stage),
    })).filter(section => section.rows.length > 0);
  }
  if (view === "to-triage") return [{ key: "backlog", label: copy.sections.backlog, rows }];
  return [{ key: "all", rows }];
};

interface QueueListProps extends QueueRowActions {
  view: RoadmapQueueView;
  data?: RoadmapItemsResponse;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  onRetry: () => void;
  filtered: boolean;
  onClearFilters: () => void;
  onSeeAll: () => void;
  selected?: string;
  touch: boolean;
  /** Pointer over the list or a row selected: rows keep their places (§4.12). */
  held: boolean;
  onRelease: () => void;
  /** Changes when the reader asks for the new order: the held snapshot is retaken. */
  releaseToken?: number;
  /** Identifies the list being asked for (the request, less its page). A new key is a new list. */
  listKey?: string;
  /** True once `data` is the answer to the current request, not the previous one kept on screen. */
  settled?: boolean;
  onLoadMore?: () => void;
  /** The rows in display order, for J/K. */
  onVisibleCodes?: (codes: string[]) => void;
}

const SkeletonRows: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <ul aria-busy="true" className="divide-y divide-border-light">
    {Array.from({ length: count }, (_, i) => (
      <li key={i} className="flex min-h-12 items-center gap-3 px-6 py-3">
        <div className="flex-1">
          <SkeletonText width="60%" />
          <SkeletonText width="35%" />
        </div>
      </li>
    ))}
  </ul>
);

/** The Queue's list: sections, skeletons, empty states and the frozen order (§4.3, §4.12). */
export const QueueList: React.FC<QueueListProps> = ({
  view,
  data,
  isLoading,
  isFetching,
  isError,
  onRetry,
  filtered,
  onClearFilters,
  onSeeAll,
  selected,
  touch,
  held,
  onRelease,
  releaseToken = 0,
  listKey,
  settled = true,
  onLoadMore,
  onVisibleCodes,
  ...actions
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  const liveSections = useMemo(() => sectionsFor(view, data), [view, data]);

  // The snapshot shown while the list is held. Taken when the hold starts; dropped when it ends.
  const [snapshot, setSnapshot] = useState<QueueSection[] | null>(null);
  const liveRef = useRef(liveSections);
  liveRef.current = liveSections;
  // A snapshot belongs to the list it was taken from. Switching tab, filter or sort while an idea
  // is open (so the list is held) asks for a different list; freezing against the old snapshot
  // marked every row of the new one as "new, wait" and showed an empty list. So the snapshot is
  // dropped when the request changes and retaken once the new list has actually arrived.
  useEffect(() => {
    setSnapshot(held && settled ? liveRef.current : null);
  }, [held, view, releaseToken, listKey, settled]);

  const display = useMemo(() => {
    let orderChanged = false;
    const sections = liveSections.map(section => {
      const heldSection = snapshot?.find(s => s.key === section.key);
      if (!heldSection) return { ...section, display: liveRows(section.rows) };
      const frozen = freezeOrder(heldSection.rows, section.rows);
      orderChanged = orderChanged || frozen.orderChanged;
      return { ...section, display: frozen.rows };
    });
    return { sections, orderChanged };
  }, [liveSections, snapshot]);

  const visibleCodes = useMemo(
    () => display.sections.flatMap(s => s.display.filter(r => !r.gone).map(r => r.row.code)),
    [display],
  );
  useEffect(() => {
    onVisibleCodes?.(visibleCodes);
  }, [visibleCodes, onVisibleCodes]);

  if (isLoading) return <SkeletonRows />;

  if (isError && !data) {
    return (
      <div className="flex flex-col items-start gap-3 p-6" role="alert">
        <p className="text-sm text-typography-primary">{copy.loadError}</p>
        <Button kind="tertiary" size="sm" onClick={onRetry}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  const total = visibleCodes.length;

  if (total === 0) {
    if (filtered) {
      return (
        <div className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-typography-primary">{copy.empty.noMatches}</p>
          <Button kind="tertiary" size="sm" onClick={onClearFilters}>
            {copy.filter.clear}
          </Button>
        </div>
      );
    }
    if (view === "to-triage") {
      return (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <motion.span
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-success-600 text-success-600"
            initial={reduced ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={motionTransition("slow", "expressive", reduced)}
            aria-hidden
          >
            <Tick size={24} />
          </motion.span>
          <motion.p
            className="text-sm text-typography-primary"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTransition("slow", "expressive", reduced)}
          >
            {copy.empty.allCaughtUp}
          </motion.p>
        </div>
      );
    }
    if (view === "for-you") {
      // First visit: one line on the five stages, and All ideas one click away (§4.7).
      return (
        <div className="flex flex-col items-start gap-2 p-6">
          <p className="text-sm text-typography-secondary">{copy.empty.needsYou}</p>
          <h3 className="mt-4 text-base font-semibold text-typography-primary">
            {copy.empty.noIdeasTitle}
          </h3>
          <p className="max-w-prose text-sm text-typography-secondary">{copy.empty.noIdeasBody}</p>
          <div className="flex flex-wrap items-center gap-2">
            <NewIdeaButton />
            <Button kind="tertiary" size="sm" onClick={onSeeAll}>
              {copy.empty.seeAllIdeas}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <p className="p-6 text-sm text-typography-secondary">
        {view === "leading" ? copy.empty.leading : copy.empty.all}
      </p>
    );
  }

  const nextCursor = data && "rows" in data ? data.nextCursor : undefined;

  return (
    <div className="relative">
      <AnimatePresence>
        {held && display.orderChanged && (
          <motion.div
            className="sticky top-2 z-10 flex justify-center"
            {...popVariants(reduced)}
            transition={motionTransition("moderate", "productive", reduced)}
          >
            <Button
              kind="primary"
              size="sm"
              onClick={onRelease}
              renderIcon={() => <Refresh size={14} aria-hidden />}
            >
              {copy.updatedPill}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {display.sections.map(section => {
        // For you's Needs you always shows, so "Nothing needs you right now." has a home; the
        // other sections hide while empty.
        const alwaysShow = section.key === "needsYou";
        if (section.display.length === 0 && !alwaysShow) return null;
        return (
          <section key={section.key} aria-label={section.label}>
            {section.label && (
              <h3 className="sticky top-0 z-[1] bg-neutral-50 px-6 py-1.5 text-xs font-semibold uppercase tracking-wide text-typography-secondary">
                {copy.sectionCount(section.label, section.display.filter(r => !r.gone).length)}
              </h3>
            )}
            {section.display.length === 0 ? (
              <p className="px-6 py-3 text-sm text-typography-secondary">{copy.empty.needsYou}</p>
            ) : (
              <ul className="m-0 p-0">
                <AnimatePresence initial={false}>
                  {section.display.map((item: DisplayRow, index) => (
                    <QueueRow
                      key={item.row.code}
                      row={item.row}
                      gone={item.gone}
                      selected={selected === item.row.code}
                      touch={touch}
                      index={index}
                      {...actions}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </section>
        );
      })}

      {nextCursor && onLoadMore && (
        <div className="flex justify-center p-4">
          <Button kind="ghost" size="sm" onClick={onLoadMore} disabled={isFetching}>
            {copy.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
};
