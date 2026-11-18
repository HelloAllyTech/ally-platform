import { useCallback, useEffect, useRef, useState } from "react";

import { fill, type BotPageCopy } from "./copy";

import type { PublicStep } from "./types";

/**
 * The assistant's live steps on the bot page and in the bubble (chunk 6b, section E): each step
 * as one calm line, worded by the page from a kind and at most a list's name or a day and time.
 */

/** A step's day and time as the page shows it: "Thu 19 Nov 2026, 11:00" → "Thu 19 Nov, 11:00". */
export const shortWhen = (label: string): string => label.replace(/\s+\d{4},/, ",");

// A list of times rather than things: "Checking free times…" reads better than "Looking in Slots…".
const TIMES = /\b(slots?|times?|availability|calendar|schedule)\b/i;

type Wording = BotPageCopy["steps"]["doing"] | BotPageCopy["steps"]["done"];

function line(step: PublicStep | "reading", words: Wording, business: string): string {
  const doing = words as BotPageCopy["steps"]["doing"];
  if (step === "reading") return doing.reading;
  const label = step.label;
  switch (step.kind) {
    case "search":
      return fill(words.search, { business });
    case "find":
      if (!label) return words.findAny;
      return TIMES.test(label) ? words.findTimes : fill(words.find, { list: label });
    case "create":
      return label ? fill(words.create, { when: shortWhen(label) }) : words.createAny;
    case "update":
      return words.update;
    case "cancel":
      return words.cancel;
    case "hand_over":
      return words.hand_over;
    default:
      return doing.writing ?? "";
  }
}

/** What the assistant is doing now. */
export const doingLine = (
  step: PublicStep | "reading",
  copy: BotPageCopy,
  business: string,
): string => line(step, copy.steps.doing, business);

/** What it did, for the collapsed line under the reply. Writing the reply isn't listed. */
export const doneLines = (steps: PublicStep[], copy: BotPageCopy, business: string): string[] =>
  steps
    .filter(s => s.kind !== "writing")
    .map(s => line(s, copy.steps.done, business))
    .filter((text, i, all) => all.indexOf(text) === i);

/** A step shows for at least this long, so lines don't flicker. */
export const MIN_STEP_MS = 400;
/** With no new step for this long, "Still working on it…". */
export const SLOW_AFTER_MS = 12_000;

/**
 * The step line while a reply is being worked on: starts at "Reading your message…", moves to
 * each step as it arrives but holds each for at least MIN_STEP_MS, and says it's still working
 * after SLOW_AFTER_MS with nothing new. `start` at send, `push` for each step, `stop` when the
 * reply has come.
 */
export function useLiveSteps() {
  const [current, setCurrent] = useState<PublicStep | "reading" | null>(null);
  const [slow, setSlow] = useState(false);
  const queue = useRef<PublicStep[]>([]);
  const shownAt = useRef(0);
  const pump = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armSlow = useCallback(() => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    setSlow(false);
    slowTimer.current = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
  }, []);

  const next = useCallback(() => {
    pump.current = null;
    const step = queue.current.shift();
    if (!step) return;
    setCurrent(step);
    shownAt.current = Date.now();
    armSlow();
    if (queue.current.length) pump.current = setTimeout(next, MIN_STEP_MS);
  }, [armSlow]);

  const stop = useCallback(() => {
    queue.current = [];
    if (pump.current) clearTimeout(pump.current);
    if (slowTimer.current) clearTimeout(slowTimer.current);
    pump.current = null;
    slowTimer.current = null;
    setCurrent(null);
    setSlow(false);
  }, []);

  const start = useCallback(() => {
    stop();
    setCurrent("reading");
    shownAt.current = Date.now();
    armSlow();
  }, [armSlow, stop]);

  const push = useCallback(
    (step: PublicStep) => {
      queue.current.push(step);
      if (pump.current) return;
      const wait = MIN_STEP_MS - (Date.now() - shownAt.current);
      if (wait > 0) pump.current = setTimeout(next, wait);
      else next();
    },
    [next],
  );

  useEffect(() => stop, [stop]);

  return { current, slow, start, push, stop };
}
