import React, { useState } from "react";

import { Debug, Document, List, ThreeDot } from "@icons";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

import { IdeaCaptureLauncher } from "@components/idea-capture/IdeaCapture";
import { ROUTES, en } from "@constants";

import { BottomSheet } from "./BottomSheet";
import { MoreSheetContent } from "./RoadmapAreaNav";
import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { useRoadmapRole } from "../RoadmapGate";

interface RoadmapBottomBarProps {
  /** Slides away while scrolling down, back on scroll up (§4.17). */
  hidden: boolean;
  /** For you → Needs you count, on the Queue item. */
  forYouCount?: number;
  /** Which tab the page is (Queue by default). */
  active?: "queue" | "drafts";
}

/**
 * The phone's bottom bar, within thumb reach: Queue · Drafts · New idea · Bugs · ⋯. It hides
 * while the keyboard is open (the caller passes `hidden`) and keeps clear of the home indicator.
 *
 * Drafts is Roadmap's own tab; the raised 56 px button is New idea, the same mic-bulb capture as everywhere else.
 * ⋯ opens Agent and Settings for the roles that have them, plus the weekly email and What moved.
 */
export const RoadmapBottomBar: React.FC<RoadmapBottomBarProps> = ({
  hidden,
  forYouCount,
  active = "queue",
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.mobile;
  const { role } = useRoadmapRole();
  const [moreOpen, setMoreOpen] = useState(false);
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
            className={`${item} ${active === "queue" ? "font-semibold text-primary-700" : "text-typography-secondary"}`}
            aria-current={active === "queue" ? "page" : undefined}
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
            to={ROUTES.ROADMAP_DRAFTS}
            className={`${item} ${active === "drafts" ? "font-semibold text-primary-700" : "text-typography-secondary"}`}
            aria-current={active === "drafts" ? "page" : undefined}
            tabIndex={hidden ? -1 : 0}
          >
            <Document size={20} aria-hidden />
            {copy.drafts}
          </Link>
        </li>
        <li className="flex flex-1 items-start justify-center">
          <IdeaCaptureLauncher size="lg" className="-mt-4 bg-white shadow-lg" />
        </li>
        <li className="flex flex-1">
          <Link
            to={ROUTES.ROADMAP_BUGS}
            className={`${item} text-typography-secondary`}
            tabIndex={hidden ? -1 : 0}
          >
            <Debug size={20} aria-hidden />
            {copy.bugs}
          </Link>
        </li>
        <li className="flex flex-1">
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`${item} text-typography-secondary`}
            tabIndex={hidden ? -1 : 0}
            aria-haspopup="dialog"
          >
            <ThreeDot size={20} aria-hidden />
            {en.roadmapV2Tools.tabs.more}
          </button>
        </li>
      </ul>
      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={en.roadmapV2Tools.tabs.moreTitle}
        closeLabel={copy.close}
      >
        <MoreSheetContent role={role} onNavigate={() => setMoreOpen(false)} />
      </BottomSheet>
    </motion.nav>
  );
};
