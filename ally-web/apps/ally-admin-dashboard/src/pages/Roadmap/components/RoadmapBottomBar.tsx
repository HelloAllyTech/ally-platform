import React from "react";

import { Debug, Document, List } from "@icons";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

import { ROUTES, en } from "@constants";

import { motionTransition, useReducedMotionPreference } from "../../../motion";

interface RoadmapBottomBarProps {
  /** Slides away while scrolling down, back on scroll up (§4.17). */
  hidden: boolean;
  /** For you → Needs you count, on the Queue item. */
  forYouCount?: number;
}

/**
 * The phone's bottom bar, within thumb reach: Queue · Drafts · ＋ New idea · Bugs · ⋯. It hides
 * while the keyboard is open (the caller passes `hidden`) and keeps clear of the home indicator.
 *
 * Drafts and Bugs open the existing pages until Roadmap has its own tabs for them.
 * TODO(P3): the raised ＋ New idea button (56 px) and Drafts as Roadmap's own tab.
 * TODO(P4): ⋯ with Agent and Settings, for the roles that have them.
 */
export const RoadmapBottomBar: React.FC<RoadmapBottomBarProps> = ({ hidden, forYouCount }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.mobile;
  const item = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs";
  return (
    <motion.nav
      aria-label={copy.bottomNav}
      className="fixed inset-x-0 bottom-0 z-[30] border-t border-border-light bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      initial={false}
      animate={reduced ? { opacity: hidden ? 0 : 1 } : { y: hidden ? "110%" : 0 }}
      transition={motionTransition("moderate", "productive", reduced)}
      aria-hidden={hidden}
    >
      <ul className="m-0 flex list-none items-stretch p-0">
        <li className="flex flex-1">
          <Link
            to={ROUTES.ROADMAP}
            className={`${item} font-semibold text-primary-700`}
            aria-current="page"
            tabIndex={hidden ? -1 : 0}
          >
            <span className="relative">
              <List size={20} aria-hidden />
              {forYouCount ? (
                <span className="absolute -right-3 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] text-white">
                  {forYouCount}
                </span>
              ) : null}
            </span>
            {copy.queue}
            {forYouCount ? <span className="sr-only">{copy.forYouBadge(forYouCount)}</span> : null}
          </Link>
        </li>
        <li className="flex flex-1">
          <Link
            to={`${ROUTES.PRODUCT_ROADMAP}?tab=drafts`}
            className={`${item} text-typography-secondary`}
            tabIndex={hidden ? -1 : 0}
          >
            <Document size={20} aria-hidden />
            {copy.drafts}
          </Link>
        </li>
        <li className="flex flex-1">
          <Link
            to={`${ROUTES.PRODUCT_ROADMAP}?tab=bugs`}
            className={`${item} text-typography-secondary`}
            tabIndex={hidden ? -1 : 0}
          >
            <Debug size={20} aria-hidden />
            {copy.bugs}
          </Link>
        </li>
      </ul>
    </motion.nav>
  );
};
