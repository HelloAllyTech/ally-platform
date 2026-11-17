import React, { useEffect, useRef, useState } from "react";

import { Close } from "@icons";
import { AnimatePresence, PanInfo, motion, useMotionValue, useTransform } from "framer-motion";
import { createPortal } from "react-dom";

import { Button } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapItemQuery } from "@api";
import { en } from "@constants";
import type { RoadmapItemRow } from "@types";

import { SimilarLine, SummaryFacts } from "./TriageSummary";
import { swipeDecision, workingDaysSince } from "./triageUtils";
import {
  haptic,
  motionTransition,
  springTransition,
  useReducedMotionPreference,
} from "../../../motion";
import { useRoadmapJobTimer } from "../hooks/useRoadmapJobTimer";

/** The card tilts up to this many degrees as it follows the finger (§4.18 "Triage card"). */
const MAX_TILT_DEG = 4;

interface TriageReviewModeProps {
  open: boolean;
  rows: RoadmapItemRow[];
  sectionOf: (code: string) => string | undefined;
  onClose: () => void;
  onAccept: (row: RoadmapItemRow) => Promise<boolean>;
  /** Opens the reason sheet, with the suggested reason pre-selected. */
  onDecline: (row: RoadmapItemRow) => void;
  onPickLead: (row: RoadmapItemRow) => void;
}

/**
 * Triage review mode (Owner, phone and tablet; §4.17): one card at a time, the next peeking behind.
 * A swipe past 40% of the width commits — right accepts, left opens the decline reason sheet —
 * and short of that the card springs back. Each commit gives a light haptic and an Undo toast.
 * Every swipe has a button below. Under reduced motion there's no drag or tilt: the buttons decide
 * and the next card crossfades in.
 */
export const TriageReviewMode: React.FC<TriageReviewModeProps> = ({
  open,
  rows,
  sectionOf,
  onClose,
  onAccept,
  onDecline,
  onPickLead,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.triage;
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [fly, setFly] = useState<"accept" | "decline" | null>(null);
  const totalRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setDecided(new Set());
    totalRef.current = rows.length;
    requestAnimationFrame(() => closeRef.current?.focus());
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const queue = rows.filter(r => !decided.has(r.code));
  const current = queue[0];

  // P8: the card in front starts "triage one" for it (§4.16); the decision ends it.
  const jobs = useRoadmapJobTimer();
  const currentCode = open ? current?.code : undefined;
  const currentAwaiting = !!currentCode && sectionOf(currentCode) === "awaitingReview";
  useEffect(() => {
    if (currentCode && currentAwaiting) {
      jobs.start("triage_one", { itemId: currentCode, restart: true });
    }
    // Per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCode, currentAwaiting]);
  const next = queue[1];
  const total = Math.max(totalRef.current, rows.length);
  const index = Math.min(total, total - queue.length + 1);

  const accept = async (row: RoadmapItemRow) => {
    if (sectionOf(row.code) !== "awaitingReview") {
      onPickLead(row);
      return;
    }
    setFly("accept");
    setDecided(prev => new Set(prev).add(row.code));
    const ok = await onAccept(row);
    if (!ok) {
      setDecided(prev => {
        const n = new Set(prev);
        n.delete(row.code);
        return n;
      });
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[9000] flex flex-col bg-neutral-50"
      role="dialog"
      aria-modal="true"
      aria-label={copy.reviewMode}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransition("slow", "productive", reduced)}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <header className="flex h-14 items-center justify-between border-b border-border-light bg-white px-4">
        <h2 className="m-0 text-base font-semibold text-typography-primary" aria-live="polite">
          {current ? copy.reviewTitle(index, total) : en.roadmapV2.views["to-triage"]}
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center gap-1 rounded px-2 text-sm text-primary-700"
        >
          <Close size={18} aria-hidden />
          {copy.done}
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {!current ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="m-0 text-base text-typography-primary">{copy.reviewEmpty}</p>
            <Button kind="tertiary" size="lg" onClick={onClose}>
              {copy.reviewAgain}
            </Button>
          </div>
        ) : (
          <div className="relative h-full max-h-[560px] w-full max-w-md">
            {next && (
              <motion.div
                key={`peek-${next.code}`}
                className="absolute inset-0"
                initial={false}
                animate={reduced ? { opacity: 0 } : { scale: 0.96, y: 10, opacity: 1 }}
                transition={motionTransition("moderate", "productive", reduced)}
                aria-hidden
              >
                <CardBody row={next} section={sectionOf(next.code)} />
              </motion.div>
            )}
            <AnimatePresence initial={false} custom={fly}>
              <SwipeCard
                key={current.code}
                row={current}
                section={sectionOf(current.code)}
                fly={fly}
                onAccept={() => void accept(current)}
                onDecline={() => {
                  setFly("decline");
                  onDecline(current);
                }}
              />
            </AnimatePresence>
          </div>
        )}
      </div>

      {current && (
        <>
          <p className="m-0 pb-2 text-center text-xs text-typography-secondary" aria-hidden>
            {copy.swipeHint}
          </p>
          <footer className="grid grid-cols-3 gap-2 border-t border-border-light bg-white px-4 py-3">
            <Button
              kind="secondary"
              size="lg"
              className="max-w-none"
              disabled={sectionOf(current.code) !== "awaitingReview"}
              onClick={() => {
                setFly("decline");
                onDecline(current);
              }}
            >
              {en.roadmapV2.review.decline}
            </Button>
            <Button
              kind="tertiary"
              size="lg"
              className="max-w-none"
              onClick={() => onPickLead(current)}
            >
              {en.roadmapV2.review.pickLead}
            </Button>
            <Button
              kind="primary"
              size="lg"
              className="max-w-none"
              onClick={() => void accept(current)}
            >
              {en.roadmapV2.review.accept}
            </Button>
          </footer>
        </>
      )}
    </motion.div>,
    document.body,
  );
};

const SwipeCard: React.FC<{
  row: RoadmapItemRow;
  section?: string;
  fly: "accept" | "decline" | null;
  onAccept: () => void;
  onDecline: () => void;
}> = ({ row, section, fly, onAccept, onDecline }) => {
  const reduced = useReducedMotionPreference();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const width = () => ref.current?.offsetWidth ?? 320;
  const rotate = useTransform(x, value => {
    const w = width();
    return Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, (value / w) * MAX_TILT_DEG * 2.5));
  });

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const decision = swipeDecision(info.offset.x, width());
    if (decision === "accept") {
      haptic(10);
      onAccept();
    } else if (decision === "decline") {
      haptic([15, 60, 15]);
      onDecline();
    }
    // Short of the threshold (or a decline waiting for its reason) the card springs back.
  };

  return (
    <motion.div
      ref={ref}
      className="absolute inset-0 touch-pan-y"
      style={reduced ? undefined : { x, rotate }}
      drag={reduced ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={1}
      dragSnapToOrigin
      dragTransition={{ bounceStiffness: 420, bounceDamping: 34 }}
      onDragEnd={onDragEnd}
      custom={fly}
      variants={{
        enter: reduced ? { opacity: 0 } : { scale: 0.96, opacity: 0 },
        shown: { scale: 1, opacity: 1 },
        // Flies off the way it was decided: right for accept, left for decline.
        gone: (dir: "accept" | "decline" | null) =>
          reduced
            ? { opacity: 0 }
            : dir === "decline"
              ? { x: "-140%", rotate: -MAX_TILT_DEG, opacity: 0 }
              : { x: "140%", rotate: MAX_TILT_DEG, opacity: 0 },
      }}
      initial="enter"
      animate="shown"
      exit="gone"
      transition={springTransition(reduced)}
      data-testid="roadmap-triage-card"
      data-code={row.code}
    >
      <CardBody row={row} section={section} />
    </motion.div>
  );
};

const CardBody: React.FC<{ row: RoadmapItemRow; section?: string }> = ({ row, section }) => {
  const copy = en.roadmapV2;
  const { data: item } = useGetRoadmapItemQuery(row.code);
  const days = workingDaysSince(
    row.whyHere && "since" in row.whyHere ? row.whyHere.since : row.stageSince,
  );
  return (
    <article className="flex h-full flex-col gap-3 overflow-y-auto rounded-2xl border border-border-light bg-white p-5 shadow-lg">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-lg font-semibold text-typography-primary">
          <span className="mr-2 text-xs tabular-nums text-typography-secondary">{row.code}</span>
          {row.title}
        </h3>
        {section === "awaitingReview" && (
          <span className="shrink-0 text-xs tabular-nums text-typography-secondary">
            {copy.triage.waiting(days)}
          </span>
        )}
      </header>
      <p className="m-0 text-sm text-typography-secondary">
        {row.author?.name} · {copy.status.votes(row.votes ?? 0)}
      </p>
      {item ? <SummaryFacts item={item} compact /> : null}
      <SimilarLine code={row.code} />
      <p className="m-0 text-sm text-typography-primary">
        {row.goal ? copy.triage.fitsGoal(row.goal.name) : copy.triage.noGoal}
      </p>
    </article>
  );
};
