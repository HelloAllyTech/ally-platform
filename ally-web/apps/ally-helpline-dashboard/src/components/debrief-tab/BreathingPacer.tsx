import { type FC, useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

/** The Scribe flower's five petals: rotation (degrees) at full bloom. */
const PETALS = [0, -65, -35, 65, 35];

/** hold, inhale, hold, exhale: the order and the 4 s phases of the Scribe breathing screen. */
const PHASES = ["inhale", "hold", "exhale", "hold"] as const;
const PHASE_MS = 4000;

/** 0 closed, 1 open: opens over the inhale, stays open, closes over the exhale. */
const BLOOM = [1, 1, 0, 0];

const usePrefersReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
};

/**
 * A small, silent breathing pacer for a moment of waiting (the debrief being
 * written): the same flower and four 4 s phases as the Scribe breathing
 * screen, no sound, no countdown. With reduced motion nothing moves and a
 * calm line is shown instead of the changing label. `bare` draws no box of its
 * own, for a container that is already dark.
 */
export const BreathingPacer: FC<{ bare?: boolean }> = ({ bare = false }) => {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (reduced) return undefined;
    const id = window.setInterval(() => setPhase(p => (p + 1) % PHASES.length), PHASE_MS);
    return () => window.clearInterval(id);
  }, [reduced]);

  const bloom = reduced ? 0.5 : BLOOM[phase];
  const label = reduced
    ? t("postSim.debriefCards.working.breatheCalm")
    : t(
        `postSim.debriefCards.working.breathe${PHASES[phase][0].toUpperCase()}${PHASES[phase].slice(1)}`,
      );

  return (
    <div
      data-testid="breathing-pacer"
      className={`flex flex-col items-center gap-2 text-white ${
        bare ? "" : "rounded-lg bg-typography-900 p-4"
      }`}
    >
      <p
        aria-live={reduced ? undefined : "polite"}
        className="font-primary text-base font-semibold"
      >
        {label}
      </p>
      <svg aria-hidden="true" viewBox="0 0 200 170" className="h-40 w-48">
        {PETALS.map(angle => (
          <ellipse
            key={angle}
            cx="100"
            cy="70"
            rx="16"
            ry="48"
            fill="currentColor"
            style={{
              transformOrigin: "100px 130px",
              transform: `rotate(${angle * bloom}deg)`,
              opacity: 0.2 + Math.min(bloom, 0.6),
              transition: reduced
                ? "none"
                : `transform ${PHASE_MS}ms ease-in-out, opacity ${PHASE_MS}ms ease-in-out`,
            }}
          />
        ))}
        <path d="M70 160 A30 30 0 0 1 130 160 Z" fill="currentColor" opacity="0.25" />
      </svg>
    </div>
  );
};
