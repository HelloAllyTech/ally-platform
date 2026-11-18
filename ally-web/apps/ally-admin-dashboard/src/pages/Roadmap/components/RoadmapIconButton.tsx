import React from "react";

import { IconButton } from "@ally-ui-mono/ui-shared";

/**
 * The Roadmap's icon-only button: Carbon's ghost IconButton, so it is square, takes the theme's
 * hover layer in light and dark, and tells everyone what it does on hover and focus (the label is
 * also its accessible name). `large` is the 48px touch size.
 */
export const RoadmapIconButton: React.FC<{
  label: string;
  onClick?: () => void;
  large?: boolean;
  expanded?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, large = false, expanded, children }) => (
  <IconButton
    kind="ghost"
    size={large ? "lg" : "sm"}
    align="bottom"
    label={label}
    onClick={onClick}
    aria-expanded={expanded}
  >
    {children}
  </IconButton>
);
