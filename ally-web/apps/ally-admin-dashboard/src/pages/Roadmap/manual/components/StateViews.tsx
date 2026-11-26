import React from "react";

import { motion } from "framer-motion";

import { Button } from "@ally-ui-mono/ui-shared";

import { fadeUpVariants, motionTransition, useReducedMotionPreference } from "../../../../motion";

/**
 * The manual's calm empty / not-found / failed state: one plain sentence, an optional second line,
 * and at most one action. No illustration, no exclamation.
 */
export const ManualMessage: React.FC<{
  title: string;
  hint?: string;
  action?: string;
  onAction?: () => void;
}> = ({ title, hint, action, onAction }) => {
  const reduced = useReducedMotionPreference();
  return (
    <motion.div
      role="status"
      className="flex max-w-[68ch] flex-col items-start gap-3 py-16"
      variants={fadeUpVariants(reduced, 6)}
      initial="initial"
      animate="animate"
      transition={motionTransition("moderate", "expressive", reduced)}
    >
      <p className="m-0 text-xl leading-snug text-typography-900">{title}</p>
      {hint && <p className="m-0 text-sm text-typography-600">{hint}</p>}
      {action && onAction && (
        <Button kind="tertiary" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </motion.div>
  );
};
