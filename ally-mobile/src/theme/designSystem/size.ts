/**
 * Design System - Size Tokens
 * Generated from DS-Variables.json
 *
 * Size values for component dimensions.
 * Note: These are declared for future use. Currently using existing theme.
 */

/**
 * Size scale - T-shirt sizing for component dimensions
 * Values range from 0 to 48px
 */
export const size = {
  zero: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  base: 12,
  lg: 16,
  xl: 20,
  xl2: 24,
  xl3: 32,
  xl4: 40,
  xl5: 48,
} as const;

export type Size = typeof size;
export type SizeKey = keyof typeof size;
export type SizeValue = (typeof size)[SizeKey];
