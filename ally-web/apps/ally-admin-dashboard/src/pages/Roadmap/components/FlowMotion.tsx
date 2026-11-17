import React from "react";

import { AnimatePresence, motion } from "framer-motion";

import { motionTransition, useReducedMotionPreference } from "../../../motion";

/**
 * Small motion pieces the idea flow repeats (§4.18), each with its reduced-motion path landing on
 * the same final state: a number that rolls, a ✓ that draws (and un-draws), a one-shot ring, and
 * a single sheen across a button.
 */

/** "3 of 5" rolls to "4 of 5": the number slides up out, the new one slides up in (fast). */
export const RollingNumber: React.FC<{ value: number; className?: string }> = ({
  value,
  className = "",
}) => {
  const reduced = useReducedMotionPreference();
  return (
    <span className={`relative inline-flex overflow-hidden tabular-nums ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={reduced ? { opacity: 0 } : { y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: "-100%", opacity: 0 }}
          transition={motionTransition("fast", "productive", reduced)}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

/**
 * A check's mark: an open circle, and a ✓ that draws in when it's met and un-draws on Not quite
 * (moderate). Reduced: the ✓ fades.
 */
export const DrawnCheck: React.FC<{ met: boolean; size?: number; className?: string }> = ({
  met,
  size = 20,
  className = "",
}) => {
  const reduced = useReducedMotionPreference();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={`shrink-0 ${met ? "text-success-600" : "text-typography-secondary"} ${className}`}
      aria-hidden
    >
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <motion.path
        d="M6 10.5l2.6 2.6L14.2 7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={
          reduced
            ? { opacity: met ? 1 : 0, pathLength: 1 }
            : { pathLength: met ? 1 : 0, opacity: met ? 1 : 0 }
        }
        transition={motionTransition("moderate", "productive", reduced)}
        data-met={met || undefined}
      />
    </svg>
  );
};

/**
 * The border of a panel filling in a full ring once (5 of 5: celebratory · expressive). Absolute:
 * the parent must be `relative`. Renders nothing under reduced motion; the solid border the caller
 * switches to carries the state.
 */
export const RingOnce: React.FC<{ play: boolean; radius?: number }> = ({ play, radius = 8 }) => {
  const reduced = useReducedMotionPreference();
  if (!play || reduced) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-success-600"
      aria-hidden
    >
      <motion.rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        initial={{ pathLength: 0, opacity: 1 }}
        animate={{ pathLength: 1, opacity: [1, 1, 0] }}
        transition={motionTransition("celebratory", "expressive")}
        data-testid="roadmap-ring-once"
      />
    </svg>
  );
};

/** One soft sheen across a button (Submit turning primary at 5 of 5). Removed under reduced motion. */
export const SheenOnce: React.FC<{ play: boolean }> = ({ play }) => {
  const reduced = useReducedMotionPreference();
  if (!play || reduced) return null;
  return (
    <motion.span
      className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/30"
      style={{ skewX: -20 }}
      initial={{ x: "-120%" }}
      animate={{ x: "320%" }}
      transition={motionTransition("celebratory", "expressive")}
      aria-hidden
      data-testid="roadmap-sheen"
    />
  );
};

/** Two gentle 4 px shakes for a failed send; nothing under reduced motion (Retry carries it). */
export const shakeAnimation = (reduced: boolean, failed: boolean) =>
  failed && !reduced ? { x: [0, -4, 4, -4, 4, 0] } : { x: 0 };
