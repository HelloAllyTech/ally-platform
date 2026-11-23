import React from "react";

import { MotionConfig, motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";

import { ROUTES, en } from "@constants";

import { motionTransition, useReducedMotionPreference } from "../../motion";
import { DraftView } from "./drafts/DraftView";
import { useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";

/**
 * `/roadmap/new`: New idea (§4.2). An empty draft page, private from the start; the first words
 * make the draft and its code, and the page moves to `/roadmap/i/:code` without a jump. The
 * decline note's "New idea" arrives with the author's text in router state (never in the URL).
 */
export const RoadmapNewIdeaPage: React.FC = () => {
  const breakpoint = useRoadmapBreakpoint();
  const reduced = useReducedMotionPreference();
  const location = useLocation();
  const initialText = (location.state as { text?: string } | null)?.text ?? "";
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <motion.div
        className="flex h-full min-h-0 flex-col overflow-y-auto bg-white"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={motionTransition("fast", "productive", reduced)}
      >
        <div className="flex h-12 items-center px-2">
          <Link
            to={ROUTES.ROADMAP}
            className="inline-flex h-11 items-center px-2 text-sm text-primary-700"
          >
            ‹ {en.roadmapV2.backToQueue}
          </Link>
        </div>
        <DraftView breakpoint={breakpoint} initialText={initialText} />
      </motion.div>
    </MotionConfig>
  );
};
