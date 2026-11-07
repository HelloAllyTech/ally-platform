import type { CSSProperties } from "react";

// By path, not through `@utils`: the bot page must not pull in the dashboard's barrels.
import { ALLY_BRAND_PRIMARY, isHexColour, pickOnPrimary } from "../utils/brandColour";

/** The page's accent as CSS variables, with text on it in bone or ink, whichever reads better. */
export function themeVars(accent: string | null | undefined): CSSProperties {
  const colour = isHexColour(accent) ? accent : ALLY_BRAND_PRIMARY;
  return {
    ["--bp-accent" as string]: colour,
    ["--bp-on-accent" as string]: pickOnPrimary(colour),
  };
}

/** "Sunrise Mind" → "SM": the assistant's avatar when the owner gave none. */
export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => [...word][0]?.toUpperCase() ?? "")
    .join("") || "?";
