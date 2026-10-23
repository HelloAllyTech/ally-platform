import { CSSProperties, FC, useEffect, useState } from "react";

import { safetyCopyFor } from "../copy/safetyCopy";

const IN_SECONDS = 4;
const OUT_SECONDS = 6;
const ROUNDS = 4;
const ROUND_SECONDS = IN_SECONDS + OUT_SECONDS;

export interface BreathPhase {
  round: number;
  phase: "in" | "out" | "done";
  /** 1-based count within the phase, for the reduced-motion caption. */
  count: number;
}

/** Where the guide is after `elapsed` whole seconds (4 in, 6 out, four rounds). */
export const breathPhaseAt = (elapsed: number): BreathPhase => {
  if (elapsed >= ROUNDS * ROUND_SECONDS) return { round: ROUNDS, phase: "done", count: 0 };
  const round = Math.floor(elapsed / ROUND_SECONDS) + 1;
  const within = elapsed % ROUND_SECONDS;
  return within < IN_SECONDS
    ? { round, phase: "in", count: within + 1 }
    : { round, phase: "out", count: within - IN_SECONDS + 1 };
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * "Breathe with me" (presence spec §5): the web stand-in for the app's
 * breathing exercise, offered as a chip in CARE and never started for the
 * learner. The orb already breathes at this pace; the guide invites the
 * learner to join it. Stop is always there; nothing but the use is recorded.
 *
 * PENDING CLINICAL REVIEW: pacing and wording (copy/safetyCopy.ts).
 */
export const BreatheWithMe: FC<{
  language: string;
  onReply: (text: string) => void;
  onClose: () => void;
}> = ({ language, onReply, onClose }) => {
  const copy = safetyCopyFor(language);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (elapsed === null) return undefined;
    const timer = setInterval(() => setElapsed(e => (e === null ? null : e + 1)), 1000);
    return () => clearInterval(timer);
  }, [elapsed === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const state = elapsed === null ? null : breathPhaseAt(elapsed);
  const scale = !state || state.phase === "done" ? 0.86 : state.phase === "in" ? 1 : 0.72;
  const caption =
    state && state.phase !== "done"
      ? reduced
        ? `${state.phase === "in" ? "In" : "Out"} · ${Array.from({ length: state.count }, (_, i) => i + 1).join(" · ")}`
        : state.phase === "in"
          ? copy.breatheIn
          : copy.breatheOut
      : null;

  return (
    <div
      className="flex flex-col items-center gap-6 py-6 text-center"
      data-testid="breathe-with-me"
    >
      <span
        className="g-orb"
        data-state={state && state.phase !== "done" ? "listening" : "idle"}
        style={
          {
            "--orb-size": "160px",
            transform: reduced ? undefined : `scale(${scale})`,
            opacity: reduced && state?.phase === "out" ? 0.7 : 1,
            transition: `transform ${state?.phase === "in" ? IN_SECONDS : OUT_SECONDS}s var(--ease-breath), opacity 1s linear`,
          } as CSSProperties
        }
        aria-hidden="true"
      >
        <span className="g-orb__halo" />
        <span className="g-orb__core" />
      </span>

      {state === null && (
        <>
          <p className="g-prose max-w-sm">{copy.breatheIntro}</p>
          <button
            type="button"
            onClick={() => setElapsed(0)}
            className="min-h-11 rounded-[10px] bg-[var(--g-action)] px-5 font-primary text-[15px] font-semibold text-[var(--g-on-action)]"
          >
            {copy.breatheStart}
          </button>
        </>
      )}

      {state && state.phase !== "done" && (
        <>
          <p className="g-prose" aria-live="polite">
            {caption}
          </p>
          <p className="g-caption" aria-label={`${state.round} / ${ROUNDS}`}>
            {Array.from({ length: ROUNDS }, (_, i) => (i < state.round ? "●" : "○")).join(" ")}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-[10px] border border-[var(--g-ink)] px-5 font-primary text-[15px] font-semibold"
          >
            {copy.breatheStop}
          </button>
        </>
      )}

      {state?.phase === "done" && (
        <>
          <p className="g-prose">{copy.breatheHow}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[copy.breatheBetter, copy.breatheHeavy, copy.backToCourse].map(reply => (
              <button
                key={reply}
                type="button"
                onClick={() => onReply(reply)}
                className="min-h-11 rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] px-3 font-primary text-sm"
              >
                {reply}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
