import React from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";

interface InfoTipProps {
  /** One or two sentences, written for the person using the control. */
  label: string;
  /** Accessible name for the trigger; defaults to a generic "More information". */
  ariaLabel?: string;
}

/**
 * The admin tooltip convention (ally-web/CLAUDE.md): a small icon beside jargon, a hidden side
 * effect or a cross-field dependency, rather than leaving the Ally team to learn by trial.
 */
export const InfoTip: React.FC<InfoTipProps> = ({ label, ariaLabel = "More information" }) => (
  <Tooltip label={label} align="top">
    <button
      type="button"
      aria-label={ariaLabel}
      className="inline-flex cursor-pointer items-center align-middle text-typography-600"
    >
      <TooltipIcon />
    </button>
  </Tooltip>
);
