import React from "react";

import { Tick } from "@icons";
import { motion } from "framer-motion";

import { en } from "@constants";
import type { RoadmapShownStage, RoadmapSimpleStage } from "@types";

import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { trackerModel } from "../utils/copy";

interface TrackerProps {
  stage: RoadmapShownStage | RoadmapSimpleStage;
  /** Phone: five thin segments and the stage word, not five labelled steps (§4.17). */
  compact?: boolean;
}

/**
 * The worded tracker: Submitted · Accepted · Planning · Building · Shipped (D20). A list with text,
 * never dots alone ("Stage 3 of 5: Planning"), so a screen reader hears the same thing the eye sees.
 * Declined replaces the tracker with a single labelled state.
 *
 * Motion: the connector fills left to right and the current dot scales in from 80% (§4.18
 * "Tracker advances"). Reduced motion lands on the same filled state with a fade.
 */
export const Tracker: React.FC<TrackerProps> = ({ stage, compact = false }) => {
  const reduced = useReducedMotionPreference();
  const model = trackerModel(stage);
  const copy = en.roadmapV2;

  if (model.kind === "terminal") {
    return (
      <p className="text-sm font-medium text-typography-secondary" aria-label={copy.trackerLabel}>
        <span className="inline-flex items-center rounded-full border border-border-light px-2 py-0.5">
          {model.label}
        </span>
      </p>
    );
  }

  const total = model.steps.length;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <ol className="flex flex-1 gap-1" aria-label={copy.trackerLabel}>
          {model.steps.map((step, index) => (
            <li
              key={step.stage}
              className={`h-1.5 flex-1 rounded-full ${
                step.state === "todo" ? "bg-neutral-200" : "bg-primary-600"
              }`}
            >
              <span className="sr-only">
                {copy.trackerStep(index + 1, total, step.label)}
                {step.state === "current" ? `, ${copy.trackerStepCurrent}` : ""}
                {step.state === "done" ? `, ${copy.trackerStepDone}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <ol className="flex flex-wrap items-center gap-y-1 text-xs" aria-label={copy.trackerLabel}>
      {model.steps.map((step, index) => (
        <li key={step.stage} className="flex items-center">
          {index > 0 && (
            <span
              className="relative mx-1.5 block h-0.5 w-5 overflow-hidden rounded bg-neutral-200 sm:w-8"
              aria-hidden
            >
              {step.state !== "todo" && (
                <motion.span
                  className="absolute inset-0 origin-left bg-primary-600"
                  initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
                  animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
                  transition={motionTransition("slow", "expressive", reduced)}
                />
              )}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 ${
              step.state === "current"
                ? "font-semibold text-typography-primary"
                : step.state === "done"
                  ? "text-typography-primary"
                  : "text-typography-secondary"
            }`}
          >
            {step.state === "done" && <Tick size={12} aria-hidden />}
            {step.state === "current" && (
              <motion.span
                className="inline-block h-2 w-2 rounded-full bg-primary-600"
                initial={reduced ? { opacity: 0 } : { scale: 0.8 }}
                animate={reduced ? { opacity: 1 } : { scale: 1 }}
                transition={motionTransition("slow", "expressive", reduced)}
                aria-hidden
              />
            )}
            <span>
              <span className="sr-only">{copy.trackerStep(index + 1, total, "")}</span>
              {step.label}
              {step.state === "current" && (
                <span className="sr-only">{`, ${copy.trackerStepCurrent}`}</span>
              )}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
};
