import React, { useRef, useState } from "react";

import { ArrowSolid } from "@icons";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";

import { en } from "@constants";

import { haptic, springTransition, useReducedMotionPreference } from "../../../motion";

interface SlideToConfirmProps {
  label: string;
  /** Shown once it locks, while the action runs. */
  doneLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}

const THUMB = 48;
/** Past this share of the track it locks; anything less springs back. */
export const SLIDE_THRESHOLD = 0.9;

/**
 * Slide to confirm, for a one-way action on a phone (§4.18): the thumb follows the finger; past the
 * end it locks with a haptic and the track fills. A tap can't do it by accident. Keyboard: → or End
 * on the thumb confirms, so it is never a pointer-only control. Reduced motion keeps the slide (the
 * finger still moves it) and drops the spring and the fill animation.
 */
export const SlideToConfirm: React.FC<SlideToConfirmProps> = ({
  label,
  doneLabel,
  onConfirm,
  disabled,
}) => {
  const reduced = useReducedMotionPreference();
  const trackRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const x = useMotionValue(0);
  const fill = useTransform(x, value => value + THUMB);

  const confirm = () => {
    if (done || disabled) return;
    setDone(true);
    haptic(10);
    onConfirm();
  };

  const travel = () => Math.max(0, (trackRef.current?.offsetWidth ?? 0) - THUMB);

  return (
    <div
      ref={trackRef}
      className={`relative h-12 w-full select-none overflow-hidden rounded-full border border-border-light bg-neutral-100 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <motion.div
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-full bg-primary-200"
        style={{ width: done ? "100%" : fill }}
      />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-typography-900">
        {done ? doneLabel : label}
      </span>
      <motion.button
        type="button"
        aria-label={label}
        title={en.roadmapV2Tools.slide.hint}
        disabled={disabled || done}
        className="absolute left-0 top-0 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-600 text-white shadow"
        style={{ x }}
        drag={disabled || done ? false : "x"}
        dragConstraints={trackRef}
        dragElastic={0}
        dragMomentum={false}
        onDragEnd={() => {
          if (x.get() >= travel() * SLIDE_THRESHOLD) {
            x.set(travel());
            confirm();
          } else {
            if (reduced) x.set(0);
            else animate(x, 0, springTransition(false));
          }
        }}
        onKeyDown={event => {
          if (event.key === "ArrowRight" || event.key === "End") {
            event.preventDefault();
            x.set(travel());
            confirm();
          }
        }}
      >
        <ArrowSolid size={20} aria-hidden />
      </motion.button>
    </div>
  );
};
