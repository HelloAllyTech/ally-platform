/**
 * Design System - Central Export
 *
 * This module exports all design system tokens:
 * - Colors (ACTIVE - integrated)
 * - Typography (declared, pending font setup)
 * - Spacing (declared for future use)
 * - Radius (declared for future use)
 * - Size (declared for future use)
 */

// Export color tokens (ACTIVE)
export {
  dsColors,
  neutral,
  red,
  pink,
  indigo,
  blue,
  lightBlue,
  cyan,
  green,
  lightGreen,
  amber,
  orange,
  deepOrange,
  grey,
  blackAlpha,
  whiteAlpha,
  deepPurple,
  theme,
  surface,
  feedback,
  system,
  state,
  typographyColors,
  stroke,
  icon,
} from './colors';

// Export color types
export type {
  DsColors,
  ThemeColors,
  SurfaceColors,
  FeedbackColors,
  SystemColors,
  StateColors,
  TypographyColors,
} from './colors';

// Export radius tokens (for future use)
export {radius} from './radius';
export type {Radius, RadiusKey, RadiusValue} from './radius';

// Export size tokens (for future use)
export {size} from './size';
export type {Size, SizeKey, SizeValue} from './size';
