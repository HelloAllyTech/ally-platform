import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Tick } from "@icons";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { Button, SkeletonText } from "@ally-ui-mono/ui-shared";
import { rowsOfItemsResponse } from "@api";
import { en } from "@constants";
import type { RoadmapItemRow, RoadmapItemsResponse } from "@types";

import { DeclineDialog, DeclineTarget } from "./DeclineDialog";
import { LeadPicker } from "./LeadPicker";
import { TodoGroupHeader } from "./TodoGroupHeader";
import { TodoGroupKey, WAITING_GROUPS, todoGroups } from "./todoGroups";
import { TodoSweepBanner, TodoSweepPanel } from "./TodoSweep";
import { TriageReviewMode } from "./TriageReviewMode";
import { todoNextStep, workingDaysSince } from "./triageUtils";
import { triageExit, undoLastReview, useReviewActions } from "./useReviewActions";
import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { IdeaView } from "../components/IdeaView";
import { RoadmapBreakpoint, hasReadingPane } from "../hooks/useRoadmapBreakpoint";
import { useRoadmapJobTimer } from "../hooks/useRoadmapJobTimer";
import { isTypingTarget } from "../utils/keyboard";

/** Waiting more than this many working days turns the age amber (§4.6). */
export const AMBER_AFTER_WORKING_DAYS = 5;

type Decision = "assign" | "decline";

interface TriageViewProps {
  data?: RoadmapItemsResponse;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  breakpoint: RoadmapBreakpoint;
  /** The row J/K moved to (the queue page owns it). */
  selected?: string;
  /** The idea in the pane (laptop+), or the page to open (touch). */
  open?: string;
  onOpen: (code: string) => void;
  onVisibleCodes: (codes: string[]) => void;
  /** A dialog of ours is open: the queue page's own keys stand down. */
  onOverlay?: (open: boolean) => void;
  /** Present while the server has more of the Backlog than has been loaded. */
  onLoadMore?: () => void;
}

/**
 * To triage (§4.6, D10, D11) [FP-1684]: the Backlog, every idea nobody leads yet, built for speed.
 * An Owner does one of two things with each: pick a lead (which accepts an unreviewed idea; there
 * is no separate Accept) or decline it. Single keys: L pick a lead · D decline · X select · U undo
 * (J/K/Enter/Esc stay the queue's). Each acts on the idea you are on; there is no bulk select.
 *
 * The reading pane shows the Summary first, not the conversation. On a phone or tablet the list
 * opens Review mode: one card at a time, swipe to decide (§4.17). Bulk select isn't offered there.
 */
export const TriageView: React.FC<TriageViewProps> = ({
  data,
  isLoading,
  isError,
  onRetry,
  breakpoint,
  selected,
  open,
  onOpen,
  onVisibleCodes,
  onOverlay,
  onLoadMore,
}) => {
  const copy = en.roadmapV2;
  const touch = !hasReadingPane(breakpoint);
  const actions = useReviewActions();
  // Grouped by the Owner's next step (idea-to-plan audit rec 9); Later is folded until asked for.
  const groups = useMemo(() => todoGroups(rowsOfItemsResponse(data)), [data]);
  const [laterOpen, setLaterOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const sections = useMemo(
    () =>
      groups.map(group => ({
        ...group,
        total: group.rows.length,
        rows: group.key === "later" && !laterOpen ? [] : group.rows,
      })),
    [groups, laterOpen],
  );
  const groupOf = useMemo(() => {
    const map = new Map<string, TodoGroupKey>();
    groups.forEach(group => group.rows.forEach(row => map.set(row.code, group.key)));
    return map;
  }, [groups]);
  const allRows = useMemo(() => groups.flatMap(g => g.rows), [groups]);
  const rows = useMemo(() => sections.flatMap(s => s.rows), [sections]);
  const codes = useMemo(() => rows.map(r => r.code), [rows]);
  useEffect(() => onVisibleCodes(codes), [codes, onVisibleCodes]);

  const [leaving, setLeaving] = useState<Map<string, Decision>>(() => new Map());
  const [declineFor, setDeclineFor] = useState<DeclineTarget[] | null>(null);
  const [leadFor, setLeadFor] = useState<RoadmapItemRow[] | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  useEffect(
    () => onOverlay?.(!!declineFor || !!leadFor || reviewMode),
    [declineFor, leadFor, reviewMode, onOverlay],
  );

  const rowBy = useCallback((code: string) => allRows.find(r => r.code === code), [allRows]);
  /** Still awaiting review (nobody has accepted it), so it can be declined too. */
  const needsReview = useCallback(
    (code: string) => rowBy(code)?.shownStage === "submitted",
    [rowBy],
  );

  const markLeaving = (list: string[], decision: Decision) =>
    setLeaving(prev => {
      const next = new Map(prev);
      list.forEach(c => next.set(c, decision));
      return next;
    });
  const unmark = (list: string[]) =>
    setLeaving(prev => {
      const next = new Map(prev);
      list.forEach(c => next.delete(c));
      return next;
    });

  /** The row a key acts on: the one J/K is on, or the one open in the pane. */
  const targets = useCallback((): RoadmapItemRow[] => {
    const list = selected ? [selected] : open ? [open] : [];
    return list.map(rowBy).filter(Boolean) as RoadmapItemRow[];
  }, [selected, open, rowBy]);

  /** Give these ideas a builder: only ideas whose plan the Owner has closed get here. */
  const assignRows = useCallback(
    async (list: RoadmapItemRow[], lead: { id: number; name: string }) => {
      const codesNow = list.map(r => r.code);
      markLeaving(codesNow, "assign");
      let ok = true;
      for (const r of list) ok = (await actions.pickLead(r.code, lead)) && ok;
      if (!ok) unmark(codesNow);
      return ok;
    },
    [actions],
  );

  /**
   * The next step for these ideas (lifecycle 2026-11-18): Start planning for ideas nobody has
   * planned yet, the builder picker for ideas whose plan is closed, and the idea itself for one
   * still being planned, since its plan is closed from its page.
   */
  const advanceRows = useCallback(
    async (list: RoadmapItemRow[]) => {
      const toPlan = list.filter(r => todoNextStep(r) === "plan");
      const toAssign = list.filter(r => todoNextStep(r) === "pickBuilder");
      const toClose = list.filter(r => todoNextStep(r) === "closePlan");
      for (const r of toPlan) {
        markLeaving([r.code], "assign");
        if (!(await actions.startPlanning(r.code))) unmark([r.code]);
      }
      if (toAssign.length) setLeadFor(toAssign);
      else if (toClose.length) {
        if (toPlan.length === 0) onOpen(toClose[0].code);
        toast.message(copy.triage.closePlanFirst(toClose[0].code));
      }
    },
    // markLeaving/unmark only set state, so they are left out.
    [actions, onOpen, copy],
  );

  const declineRows = useCallback(
    async (reasons: Record<string, string>) => {
      const list = Object.keys(reasons);
      markLeaving(list, "decline");
      const ok =
        list.length === 1
          ? await actions.decline(list[0], reasons[list[0]], () => unmark(list))
          : await actions.reviewMany(
              list.map(code => ({ code, decision: "decline" as const, reason: reasons[code] })),
              () => unmark(list),
            );
      if (!ok) unmark(list);
      return ok;
    },
    [actions],
  );

  // An Owner can decline any To do idea, planned or not (lifecycle 2026-11-18).
  const startDecline = (list: RoadmapItemRow[]) => {
    const declinable = list;
    if (declinable.length)
      setDeclineFor(
        declinable.map(r => ({ code: r.code, title: r.title, goalName: r.goal?.name })),
      );
  };

  // ── keys (desktop) ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (touch) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || declineFor || leadFor) return;
      if ((event.target as HTMLElement | null)?.closest?.("[role='dialog'], [role='menu']")) return;
      const key = event.key.toLowerCase();
      if (!["l", "d", "u"].includes(key)) return;
      event.preventDefault();
      if (key === "u") {
        undoLastReview();
        return;
      }
      const list = targets();
      if (list.length === 0) return;
      if (key === "l") void advanceRows(list);
      if (key === "d") startDecline(list);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [touch, declineFor, leadFor, selected, open, targets, advanceRows]);

  // P8: a row awaiting review taking focus (J/K or opened) starts "triage one" for it; picking a
  // lead or Decline ends it (useReviewActions). Moving away and back starts a fresh attempt.
  const jobs = useRoadmapJobTimer();
  const focusedCode = open ?? selected;
  const focusedAwaiting = !!focusedCode && needsReview(focusedCode);
  useEffect(() => {
    if (focusedCode && focusedAwaiting) {
      jobs.start("triage_one", { itemId: focusedCode, restart: true });
    }
    // Per focus change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCode, focusedAwaiting]);

  // ── states ──────────────────────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6" aria-busy="true">
        <SkeletonText paragraph lineCount={6} />
      </div>
    );
  }
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
  if (allRows.length === 0) return <AllCaughtUp />;

  const paneCode = open ?? selected;

  const list = (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      {!touch && (
        <p className="m-0 px-6 py-2 text-xs text-typography-secondary">{copy.triage.keysHint}</p>
      )}
      {touch && (
        <div className="px-4 py-2">
          <Button
            kind="primary"
            size="lg"
            className="w-full max-w-none"
            onClick={() => setReviewMode(true)}
          >
            {copy.triage.reviewMode}
          </Button>
          <p className="m-0 pt-1 text-xs text-typography-secondary">{copy.triage.reviewModeHelp}</p>
        </div>
      )}
      {sweepOpen ? (
        <TodoSweepPanel
          onDecline={list => startDecline(list)}
          onClose={() => setSweepOpen(false)}
        />
      ) : (
        <TodoSweepBanner onOpen={() => setSweepOpen(true)} />
      )}
      {sections.map(section =>
        section.total === 0 ? null : (
          <section
            key={section.key}
            aria-label={copy.sectionCount(
              en.roadmapIdeaToPlan.groups[section.key] ?? section.key,
              section.total,
            )}
          >
            <TodoGroupHeader
              group={section.key}
              count={section.total}
              collapsed={section.key === "later" ? !laterOpen : undefined}
              onToggle={section.key === "later" ? () => setLaterOpen(open => !open) : undefined}
            />
            <ul className="m-0 list-none p-0">
              <AnimatePresence initial={false}>
                {section.rows.map(row => (
                  <TriageRow
                    key={row.code}
                    row={row}
                    awaitingReview={WAITING_GROUPS.includes(groupOf.get(row.code) ?? "later")}
                    current={paneCode === row.code}
                    leaving={leaving.get(row.code) ?? null}
                    touch={touch}
                    onOpen={() => onOpen(row.code)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ),
      )}
      {onLoadMore && (
        <div className="flex justify-center py-3">
          <Button kind="tertiary" size="sm" onClick={onLoadMore}>
            {copy.loadMore}
          </Button>
        </div>
      )}
      <div className="h-20" aria-hidden />
    </div>
  );

  const dialogs = (
    <>
      <DeclineDialog
        open={!!declineFor}
        targets={declineFor ?? []}
        onClose={() => setDeclineFor(null)}
        onDecline={declineRows}
        sheet={touch}
      />
      <LeadPicker
        open={!!leadFor}
        code={leadFor?.[0]?.code ?? ""}
        count={leadFor?.length ?? 1}
        onClose={() => setLeadFor(null)}
        onPick={lead => assignRows(leadFor ?? [], lead)}
        sheet={touch}
      />
    </>
  );

  if (touch) {
    return (
      <>
        {list}
        {dialogs}
        <TriageReviewMode
          open={reviewMode}
          rows={rows}
          needsReview={() => true}
          onClose={() => setReviewMode(false)}
          onDecline={row => startDecline([row])}
          onPickLead={row => void advanceRows([row])}
        />
      </>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,2fr)_3fr]">
      <div className="flex min-h-0 flex-col border-r border-border-light">{list}</div>
      <div className="min-h-0 overflow-hidden">
        {paneCode && rowBy(paneCode) ? (
          // The whole idea, in place: conversation, details and the actions (Pick a lead,
          // Decline). Nothing here sends the Owner to another page.
          <IdeaView key={paneCode} code={paneCode} mode="pane" breakpoint={breakpoint} />
        ) : (
          <p className="p-6 text-sm text-typography-secondary">{copy.readingPaneEmpty}</p>
        )}
      </div>
      {dialogs}
    </div>
  );
};

const TriageRow: React.FC<{
  row: RoadmapItemRow;
  awaitingReview: boolean;
  current: boolean;
  leaving: Decision | null;
  touch: boolean;
  onOpen: () => void;
}> = ({ row, awaitingReview, current, leaving, touch, onOpen }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.triage;
  const why = row.whyHere;
  const since = why && "since" in why ? why.since : row.stageSince;
  const days = workingDaysSince(since);
  // Unreviewed ideas that have waited too long turn amber; the age is the same plain "3d" for all.
  const amber = awaitingReview && days > AMBER_AFTER_WORKING_DAYS;
  const age = copy.waiting(days);

  return (
    <motion.li
      layout={reduced ? false : "position"}
      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={{
        opacity: leaving ? 0.7 : 1,
        height: "auto",
        x: leaving && !reduced ? (leaving === "assign" ? 24 : -24) : 0,
      }}
      exit={reduced ? { opacity: 0 } : { ...triageExit(leaving, reduced), height: 0 }}
      transition={motionTransition("moderate", "productive", reduced)}
      className={`relative list-none overflow-hidden border-b border-border-light ${
        leaving === "assign"
          ? "bg-success-50"
          : leaving === "decline"
            ? "bg-neutral-100"
            : current
              ? "bg-primary-50"
              : "bg-white"
      }`}
      data-code={row.code}
      data-leaving={leaving ?? undefined}
    >
      <div className={`flex items-center gap-2 pr-4 ${touch ? "min-h-[72px]" : "min-h-12"}`}>
        <span className="w-4 shrink-0" aria-hidden />
        <button
          type="button"
          onClick={onOpen}
          aria-label={en.roadmapV2.row.open(row.code, row.title)}
          aria-current={current ? "true" : undefined}
          className="flex min-w-0 flex-1 items-baseline gap-2 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              {typeof row.queueRank === "number" && (
                <span
                  className="shrink-0 text-xs font-semibold tabular-nums text-primary-700"
                  title={en.roadmapV2.row.rankHelp(row.queueRank)}
                >
                  <span aria-hidden>#{row.queueRank}</span>
                  <span className="sr-only">{en.roadmapV2.row.rankLabel(row.queueRank)}</span>
                </span>
              )}
              <span className="shrink-0 text-xs tabular-nums text-typography-secondary">
                {row.code}
              </span>
            </span>
            <span
              className="mt-1 line-clamp-2 break-words text-base leading-snug text-typography-primary"
              title={row.title}
            >
              {row.title}
            </span>
            {(row.goal?.name || row.author?.name) && (
              <span className="mt-1 truncate text-xs text-typography-secondary">
                {[
                  row.goal?.name,
                  row.author?.name ? en.roadmapV2.people.wrote(row.author.name) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </span>
        </button>
        <span
          className={`shrink-0 text-xs tabular-nums ${amber ? "font-semibold text-warning-700" : "text-typography-secondary"}`}
          title={awaitingReview ? copy.waitingLong(days) : undefined}
        >
          {age}
          {amber && <span className="sr-only"> · {copy.waitingLong(days)}</span>}
        </span>
      </div>
    </motion.li>
  );
};

/** All caught up (§4.14, §4.18): a ✓ draws in a circle; the line fades up beneath it. */
export const AllCaughtUp: React.FC = () => {
  const reduced = useReducedMotionPreference();
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
        {en.roadmapV2.empty.allCaughtUp}
      </motion.p>
    </div>
  );
};
