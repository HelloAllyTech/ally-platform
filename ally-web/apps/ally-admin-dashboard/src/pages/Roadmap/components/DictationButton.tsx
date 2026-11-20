import React from "react";

import { Mic } from "@icons";
import { AnimatePresence, motion } from "framer-motion";

import { en } from "@constants";

import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { DictationState, formatClock, useDictation } from "../hooks/useDictation";

interface DictationButtonProps {
  /** The draft or idea the mic is on (its spend is charged there). */
  code?: string;
  /** The words, once transcribed. The caller puts them in its box; they are never sent. */
  onText: (text: string) => void;
  /** Phone: a 56 px round button above the keyboard (§4.17). */
  large?: boolean;
  disabled?: boolean;
  /** Names the box the words go into, for the button's accessible name. */
  boxLabel?: string;
}

const messageFor = (state: DictationState): string => {
  const copy = en.roadmapV2.dictation;
  switch (state) {
    case "blocked":
      return copy.blocked;
    case "unavailable":
      return copy.unavailable;
    case "failed":
      return copy.failed;
    case "capReached":
      return copy.capReached;
    case "nothingHeard":
      return copy.nothingHeard;
    default:
      return "";
  }
};

/**
 * 🎤 Dictation (D9, §4.2, §4.18): the mic morphs into a red recording pill with a dot, a timer and
 * live level bars that follow your voice; on stop the bars collapse and the words type into the
 * box. Under reduced motion the pill is a static "Recording · 0:12". Screen readers hear
 * "Recording" and "Stopped". Failures say what happened and leave the typed text alone (§4.7).
 */
export const DictationButton: React.FC<DictationButtonProps> = ({
  code,
  onText,
  large = false,
  disabled = false,
  boxLabel,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.dictation;
  const { state, elapsedMs, levels, toggle, cancel } = useDictation({ code, onText });
  const recording = state === "recording";
  const busy = state === "transcribing" || state === "starting";
  const message = messageFor(state);
  const size = large ? "h-14 min-w-14" : "h-8 min-w-8";
  const label = recording ? copy.stop : boxLabel ? `${copy.start}: ${boxLabel}` : copy.start;

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1">
        <motion.button
          type="button"
          layout={reduced ? false : true}
          onClick={toggle}
          disabled={disabled || busy}
          aria-label={label}
          aria-pressed={recording}
          className={`inline-flex items-center justify-center gap-2 overflow-hidden rounded-full disabled:opacity-50 ${size} ${
            recording
              ? "bg-red-600 px-3 text-white"
              : large
                ? "bg-primary-600 text-white shadow"
                : "text-typography-secondary hover:bg-neutral-100"
          }`}
          transition={motionTransition("fast", "productive", reduced)}
          data-testid="roadmap-dictation"
        >
          {recording ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full bg-white" aria-hidden />
              {reduced ? (
                <span className="text-xs tabular-nums">
                  {copy.recordingTime(formatClock(elapsedMs))}
                </span>
              ) : (
                <>
                  <span className="text-xs tabular-nums">{formatClock(elapsedMs)}</span>
                  <span className="flex h-4 items-center gap-0.5" aria-hidden>
                    {levels.map((level, i) => (
                      <motion.span
                        key={i}
                        className="block h-4 w-0.5 origin-center rounded bg-white"
                        animate={{ scaleY: 0.2 + level * 0.8 }}
                        exit={{ scaleY: 0 }}
                        transition={{ duration: 0.08, ease: "linear" }}
                      />
                    ))}
                  </span>
                </>
              )}
            </>
          ) : (
            <Mic size={large ? 24 : 16} aria-hidden />
          )}
        </motion.button>
        {recording && (
          <button
            type="button"
            onClick={cancel}
            className="text-xs text-typography-secondary underline-offset-2 hover:underline"
          >
            {copy.cancelHint}
          </button>
        )}
      </span>
      {/* Recording, saving and agent-turn status are polite live regions (§4.10). */}
      <span className="sr-only" aria-live="polite">
        {recording ? copy.recording : state === "transcribing" ? copy.transcribing : ""}
      </span>
      <AnimatePresence>
        {(message || state === "transcribing") && (
          <motion.span
            key={state}
            role={message ? "status" : undefined}
            className="max-w-64 text-right text-xs text-typography-secondary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition("fast", "productive", reduced)}
          >
            {message || copy.transcribing}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};
