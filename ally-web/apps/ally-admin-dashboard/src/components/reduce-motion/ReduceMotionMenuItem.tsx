import React from "react";

import { en } from "@constants";

import { useReduceMotionSwitch } from "../../motion/roadmapMotion";

/**
 * The in-app **Reduce motion** switch, in the user menu (plans/roadmap-builder-merge §4.18). It sits
 * alongside the device's `prefers-reduced-motion`: either one turns movement into quick fades in
 * Roadmap. Kept in this browser (localStorage), like the colour mode.
 */
export const ReduceMotionMenuItem: React.FC = () => {
  const [on, setOn] = useReduceMotionSwitch();
  const copy = en.roadmapV2.reduceMotion;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onMouseDown={event => event.preventDefault()}
      onClick={() => setOn(!on)}
      title={copy.help}
      className="flex w-full flex-row items-center justify-between gap-2 px-4 py-2 text-left text-sm text-typography-900 hover:bg-background-secondary"
    >
      <span>{copy.label}</span>
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          on ? "bg-primary-600" : "bg-neutral-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
};
