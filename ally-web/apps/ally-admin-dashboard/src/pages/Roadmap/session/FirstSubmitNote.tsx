import React, { useState } from "react";

import { AnimatePresence, motion } from "framer-motion";

import { en } from "@constants";

import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { takeFirstSubmit } from "../drafts/draftUtils";

/**
 * First idea submitted, once per person (§4.14): a short inline note on the idea — no modal. It
 * fades up as tracker step 1 draws in (§4.18 "Earned moments", slow · expressive).
 */
export const FirstSubmitNote: React.FC<{ code: string }> = ({ code }) => {
  const reduced = useReducedMotionPreference();
  const [show] = useState(() => takeFirstSubmit(code));
  return (
    <AnimatePresence>
      {show && (
        <motion.p
          className="m-0 rounded bg-success-50 px-3 py-2 text-sm text-typography-primary"
          role="status"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            ...motionTransition("slow", "expressive", reduced),
            delay: reduced ? 0 : 0.2,
          }}
          data-testid="roadmap-first-submit-note"
        >
          {en.roadmapV2.draft.firstSubmitNote}
        </motion.p>
      )}
    </AnimatePresence>
  );
};
