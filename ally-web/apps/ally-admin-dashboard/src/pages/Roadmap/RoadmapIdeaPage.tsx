import React, { useEffect, useRef } from "react";

import { MotionConfig, motion } from "framer-motion";
import { useParams } from "react-router-dom";

import { useUser } from "@hooks";

import { motionTransition, useReducedMotionPreference } from "../../motion";
import { IdeaView } from "./components/IdeaView";
import { useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { useRoadmapRealtime } from "./hooks/useRoadmapRealtime";

/**
 * `/roadmap/i/:code` — one idea's page for the rest of its life (§4.5). On a phone it pushes in
 * from the right over the list (§4.18 "Row → page"); Back reverses it through the router.
 */
export const RoadmapIdeaPage: React.FC = () => {
  const { code = "" } = useParams<{ code: string }>();
  const { user } = useUser();
  const breakpoint = useRoadmapBreakpoint();
  const reduced = useReducedMotionPreference();
  const { presence } = useRoadmapRealtime({
    enabled: !!code,
    currentUserId: user?.id,
    openCode: code,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus the title on arrival, so a screen reader starts at the idea, not at the shell.
  useEffect(() => {
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [code]);

  const push = breakpoint === "phone" && !reduced;

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <motion.div
        key={code}
        className="flex h-full min-h-0 flex-col bg-white"
        initial={push ? { opacity: 0, x: "30%" } : { opacity: 0 }}
        animate={{ opacity: 1, x: 0 }}
        transition={motionTransition(push ? "slow" : "fast", "productive", reduced)}
      >
        <IdeaView
          code={code}
          mode="page"
          breakpoint={breakpoint}
          presence={presence}
          headingRef={headingRef}
        />
      </motion.div>
    </MotionConfig>
  );
};
