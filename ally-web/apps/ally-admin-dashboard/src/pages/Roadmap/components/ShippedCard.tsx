import React, { useEffect, useRef } from "react";

import { motion } from "framer-motion";

import { en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { isAuthorOf, outcomeLine, shippedFacts } from "../utils/delight";
import { hasCelebrated, markCelebrated } from "../utils/localStore";

/** About 40 particles over 1.2 s, from the card (§4.18). */
export const SHIPPED_CONFETTI = { particleCount: 40, spread: 70, ticks: 120, startVelocity: 28 };

/** Tailwind classes whose colours the burst borrows, so it is the admin's own palette. */
const PALETTE_CLASSES = ["bg-primary-600", "bg-primary-400", "bg-green-600", "bg-amber-400"];

const toHex = (rgb: string): string | null => {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, "0")).join("")}`;
};

/** Read the theme's colours off real elements; canvas-confetti wants hex strings. */
const themePalette = (): string[] | undefined => {
  try {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const colours = PALETTE_CLASSES.map(cls => {
      probe.className = cls;
      return toHex(getComputedStyle(probe).backgroundColor);
    }).filter((c): c is string => !!c);
    probe.remove();
    return colours.length ? colours : undefined;
  } catch {
    return undefined;
  }
};

/** One short burst. Loaded only when an author first sees their idea shipped. */
export const fireShippedConfetti = async (origin: { x: number; y: number }): Promise<void> => {
  try {
    const { default: confetti } = await import("canvas-confetti");
    void confetti({
      ...SHIPPED_CONFETTI,
      origin,
      colors: themePalette(),
      disableForReducedMotion: true,
      zIndex: 9200,
    });
  } catch {
    // A missing burst is a missing flourish, never an error.
  }
};

interface ShippedCardProps {
  item: RoadmapItemDetail;
  currentUserId?: number | string | null;
}

/**
 * The Shipped card at the top of the conversation (§4.14): the release date, the apps it went out
 * in, how many people backed it, and the outcome line once the review lands. It unfolds once; the
 * author alone gets one short confetti burst, the first time they see it, and never under Reduce
 * motion, which keeps every fact and drops the movement (§4.18). Exclamation marks only here.
 */
export const ShippedCard: React.FC<ShippedCardProps> = ({ item, currentUserId }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2Tools.shipped;
  const ref = useRef<HTMLDivElement>(null);
  const shipped = item.shownStage === "shipped";
  const author = isAuthorOf(item, currentUserId);

  useEffect(() => {
    if (!shipped || !author || hasCelebrated(item.code)) return;
    // Mark first, so a reload mid-burst never plays it twice.
    markCelebrated(item.code);
    if (reduced) return;
    const rect = ref.current?.getBoundingClientRect();
    const origin =
      rect && window.innerWidth && window.innerHeight
        ? {
            x: (rect.left + rect.width / 2) / window.innerWidth,
            y: (rect.top + rect.height / 3) / window.innerHeight,
          }
        : { x: 0.5, y: 0.3 };
    void fireShippedConfetti(origin);
  }, [shipped, author, item.code, reduced]);

  if (!shipped) return null;
  const facts = shippedFacts(item);
  const outcome = outcomeLine(item.outcome?.review);
  const details = [
    facts.date ? copy.liveSince(facts.date) : null,
    facts.apps.length ? copy.inApps(facts.apps.join(", ")) : null,
  ].filter(Boolean);

  return (
    <motion.section
      ref={ref}
      aria-label={copy.title}
      data-testid="roadmap-shipped-card"
      className="mb-4 flex flex-col gap-1 border border-green-200 bg-success-50 px-4 py-3"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={motionTransition("celebratory", "expressive", reduced)}
    >
      <h3 className="m-0 text-base font-semibold text-typography-900">{copy.title}</h3>
      {details.length > 0 && <p className="m-0 text-sm text-typography-900">{details.join(" ")}</p>}
      {facts.backers > 0 && (
        <p className="m-0 text-sm text-typography-600">{copy.backers(facts.backers)}</p>
      )}
      {outcome && (
        <p className="m-0 text-sm text-typography-900">
          <span className="font-medium">{copy.outcome}: </span>
          {outcome}
        </p>
      )}
    </motion.section>
  );
};
