/**
 * Design System - Radius Tokens
 * Generated from DS-Variables.json
 *
 * Border radius values for consistent component styling.
 * Note: These are declared for future use. Currently using existing theme.
 */

/**
 * Radius scale - T-shirt sizing for border radius
 * Values range from 0 to 999 (full rounded)
 */
export const radius = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 8,
  xl: 12,
  xl2: 16,
  xl3: 24,
  xl4: 32,
  xl5: 48,
  full: 999,
} as const;

// Type export for TypeScript autocomplete
export type Radius = typeof radius;
export type RadiusKey = keyof typeof radius;
export type RadiusValue = (typeof radius)[RadiusKey];
