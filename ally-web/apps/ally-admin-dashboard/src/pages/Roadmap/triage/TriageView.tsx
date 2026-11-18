import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Tick } from "@icons";
import { AnimatePresence, motion } from "framer-motion";

import { Button, SkeletonText } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { RoadmapItemRow, RoadmapItemsResponse } from "@types";

import { DeclineDialog, DeclineTarget } from "./DeclineDialog";
import { LeadPicker } from "./LeadPicker";
import { TriageReviewMode } from "./TriageReviewMode";
import { workingDaysSince } from "./triageUtils";
import { triageExit, undoLastReview, useReviewActions } from "./useReviewActions";
import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { RollingNumber } from "../components/FlowMotion";
import { IdeaView } from "../components/IdeaView";
import { sectionsFor } from "../components/QueueList";
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
}

/**
 * To triage (§4.6, D10, D11) [FP-1684]: the Backlog, every idea nobody leads yet, built for speed.
 * An Owner does one of two things with each: pick a lead (which accepts an unreviewed idea; there
 * is no separate Accept) or decline it. Single keys: L pick a lead · D decline · X select · U undo
 * (J/K/Enter/Esc stay the queue's). X selects rows, and D or L then apply to every selected row;
 * bulk decline asks one reason, editable per idea; one undo reverses the whole batch (§4.11).
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
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  const touch = !hasReadingPane(breakpoint);
  const actions = useReviewActions();
  const sections = useMemo(() => sectionsFor("to-triage", data), [data]);
  const rows = useMemo(() => sections.flatMap(s => s.rows), [sections]);
  const codes = useMemo(() => rows.map(r => r.code), [rows]);
  useEffect(() => onVisibleCodes(codes), [codes, onVisibleCodes]);

  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [leaving, setLeaving] = useState<Map<string, Decision>>(() => new Map());
  const [declineFor, setDeclineFor] = useState<DeclineTarget[] | null>(null);
  const [leadFor, setLeadFor] = useState<RoadmapItemRow[] | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  useEffect(
    () => onOverlay?.(!!declineFor || !!leadFor || reviewMode),
    [declineFor, leadFor, reviewMode, onOverlay],
  );

  // Rows that left the list drop out of the selection too.
  useEffect(() => {
    setChecked(prev => {
      const next = new Set([...prev].filter(c => codes.includes(c)));
      return next.size === prev.size ? prev : next;
    });
  }, [codes]);

  const rowBy = useCallback((code: string) => rows.find(r => r.code === code), [rows]);
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

  /** The rows a key acts on: the checked ones, or the one J/K is on. */
  const targets = useCallback((): RoadmapItemRow[] => {
    const list = checked.size ? [...checked] : selected ? [selected] : open ? [open] : [];
    return list.map(rowBy).filter(Boolean) as RoadmapItemRow[];
  }, [checked, selected, open, rowBy]);

  /** Give these ideas a lead. An unreviewed one is accepted by it; an accepted one just gets it. */
  const assignRows = useCallback(
    async (list: RoadmapItemRow[], lead: { id: number; name: string }) => {
      const review = list.filter(r => needsReview(r.code));
      const assign = list.filter(r => !needsReview(r.code));
      const codesNow = list.map(r => r.code);
      markLeaving(codesNow, "assign");
      let ok = true;
      if (review.length === 1 && assign.length === 0) {
        ok = await actions.assign(review[0].code, lead, () => unmark(codesNow));
      } else if (review.length) {
        ok = await actions.reviewMany(
          review.map(r => ({ code: r.code, decision: "accept" as const, leadUserId: lead.id })),
          () => unmark(codesNow),
        );
      }
      for (const r of assign) ok = (await actions.pickLead(r.code, lead)) && ok;
      if (!ok) unmark(codesNow);
      else setChecked(new Set());
      return ok;
    },
    [actions, needsReview],
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
      else setChecked(new Set());
      return ok;
    },
    [actions],
  );

  const startDecline = (list: RoadmapItemRow[]) => {
    const declinable = list.filter(r => needsReview(r.code));
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
      if (!["l", "d", "x", "u"].includes(key)) return;
      event.preventDefault();
      if (key === "u") {
        undoLastReview();
        return;
      }
      if (key === "x") {
        const code = selected ?? open;
        if (!code) return;
        setChecked(prev => {
          const next = new Set(prev);
          if (next.has(code)) next.delete(code);
          else next.add(code);
          return next;
        });
        return;
      }
      const list = targets();
      if (list.length === 0) return;
      if (key === "l") setLeadFor(list);
      if (key === "d") startDecline(list);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, declineFor, leadFor, selected, open, targets, assignRows]);

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
  if (rows.length === 0) return <AllCaughtUp />;

  const selectMode = checked.size > 0;
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
      {sections.map(section =>
        section.rows.length === 0 ? null : (
          <section key={section.key} aria-label={section.label}>
            <h3 className="sticky top-0 z-[1] bg-neutral-50 px-6 py-1.5 text-xs font-semibold uppercase tracking-wide text-typography-secondary">
              {copy.sectionCount(section.label ?? section.key, section.rows.length)}
            </h3>
            <ul className="m-0 list-none p-0">
              <AnimatePresence initial={false}>
                {section.rows.map(row => (
                  <TriageRow
                    key={row.code}
                    row={row}
                    awaitingReview={row.shownStage === "submitted"}
                    current={paneCode === row.code}
                    checked={checked.has(row.code)}
                    selectMode={selectMode && !touch}
                    leaving={leaving.get(row.code) ?? null}
                    touch={touch}
                    onToggle={() =>
                      setChecked(prev => {
                        const next = new Set(prev);
                        if (next.has(row.code)) next.delete(row.code);
                        else next.add(row.code);
                        return next;
                      })
                    }
                    onOpen={() => onOpen(row.code)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ),
      )}
      <div className="h-20" aria-hidden />
      {/* The selection bar rises from the bottom with the count rolling (§4.18 "Bulk select"). */}
      <AnimatePresence>
        {selectMode && !touch && (
          <motion.div
            className="sticky bottom-0 z-[2] flex items-center gap-2 border-t border-border-light bg-white px-4 py-2 shadow"
            initial={reduced ? { opacity: 0 } : { y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: "100%", opacity: 0 }}
            transition={motionTransition("moderate", "productive", reduced)}
            role="region"
            aria-label={copy.triage.selected(checked.size)}
          >
            <span className="text-sm text-typography-primary" aria-live="polite">
              <RollingNumber value={checked.size} />{" "}
              <span className="sr-only">{copy.triage.selected(checked.size)}</span>
            </span>
            <Button kind="ghost" size="sm" onClick={() => setChecked(new Set())}>
              {copy.triage.clearSelection}
            </Button>
            <span className="ml-auto flex gap-2">
              <Button kind="secondary" size="sm" onClick={() => startDecline(targets())}>
                {copy.review.decline}
              </Button>
              <Button kind="primary" size="sm" onClick={() => setLeadFor(targets())}>
                {copy.review.pickLead}
              </Button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
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
          needsReview={needsReview}
          onClose={() => setReviewMode(false)}
          onDecline={row => startDecline([row])}
          onPickLead={row => setLeadFor([row])}
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
  checked: boolean;
  selectMode: boolean;
  leaving: Decision | null;
  touch: boolean;
  onToggle: () => void;
  onOpen: () => void;
}> = ({ row, awaitingReview, current, checked, selectMode, leaving, touch, onToggle, onOpen }) => {
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
        <AnimatePresence initial={false}>
          {selectMode ? (
            <motion.label
              key="box"
              className="flex h-12 w-10 shrink-0 cursor-pointer items-center justify-center"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
              transition={motionTransition("moderate", "productive", reduced)}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={onToggle}
                aria-label={copy.select(row.code)}
                className="h-4 w-4"
              />
            </motion.label>
          ) : (
            <span key="dot" className="w-6 shrink-0" aria-hidden />
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={onOpen}
          aria-label={en.roadmapV2.row.open(row.code, row.title)}
          aria-current={current ? "true" : undefined}
          className="flex min-w-0 flex-1 items-baseline gap-2 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          {row.rank != null && (
            <span
              className="min-w-[2.25rem] shrink-0 text-right text-xs font-semibold tabular-nums text-primary-700"
              title={en.roadmapV2.row.rankHelp(row.rank)}
            >
              <span aria-hidden>{en.roadmapV2.row.rank(row.rank)}</span>
              <span className="sr-only">{en.roadmapV2.row.rankLabel(row.rank)}</span>
            </span>
          )}
          <span className="shrink-0 text-xs tabular-nums text-typography-secondary">
            {row.code}
          </span>
          <span className="min-w-0 truncate text-sm text-typography-primary">{row.title}</span>
        </button>
        <span
          className={`shrink-0 text-xs tabular-nums ${amber ? "font-semibold text-warning-700" : "text-typography-secondary"}`}
          title={awaitingReview ? copy.waitingLong(days) : undefined}
        >
          {age}
          {amber && <span className="sr-only"> · {copy.waitingLong(days)}</span>}
        </span>
        {!selectMode && !touch && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={copy.select(row.code)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-typography-secondary opacity-60 hover:bg-neutral-100 hover:opacity-100 focus-visible:opacity-100"
          >
            <span aria-hidden className="h-3.5 w-3.5 rounded-sm border border-current" />
          </button>
        )}
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
