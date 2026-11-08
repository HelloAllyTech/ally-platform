import type { CSSProperties } from "react";

import { ALLY_BRAND_PRIMARY, isHexColour, pickOnPrimary } from "../utils/brandColour";

import type { BotPageBranding } from "./types";

// By path, not through `@utils`: the bot page must not pull in the dashboard's barrels.

/** The page's accent as CSS variables, with text on it in bone or ink, whichever reads better. */
export function themeVars(accent: string | null | undefined): CSSProperties {
  const colour = isHexColour(accent) ? accent : ALLY_BRAND_PRIMARY;
  return {
    ["--bp-accent" as string]: colour,
    ["--bp-on-accent" as string]: pickOnPrimary(colour),
  };
}

/**
 * The visitor surface's attributes (chunk 20d): the brand colour and the text colour on it, the
 * theme and the heading style, for `.brand-surface` in the v2 tokens. The accent ally-be sends is
 * already contrast-corrected.
 */
export function surfaceProps(branding: BotPageBranding): {
  style: CSSProperties;
  "data-theme": string;
  "data-heading": string;
} {
  const accent = branding.look?.accent ?? branding.accentColour;
  const colour = isHexColour(accent) ? accent : ALLY_BRAND_PRIMARY;
  return {
    style: {
      ...themeVars(colour),
      ["--brand-accent" as string]: colour,
      ["--brand-on-accent" as string]: pickOnPrimary(colour),
    },
    "data-theme": branding.look?.theme ?? "light",
    "data-heading": branding.look?.headingStyle ?? "classic",
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
