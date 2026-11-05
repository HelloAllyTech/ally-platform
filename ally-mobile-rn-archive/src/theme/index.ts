// Legacy theme exports (for backward compatibility)
export {colors, legacyColors} from './colors';
export type {Colors, LegacyColors} from './colors';
export {fontFamily} from './fonts';
export {typography, fontWeights} from './typography';
export type {TypographyStyle, FontWeight} from './typography';
export {globalStyles} from './helpers';

// Design system exports (NEW)
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
  blueAlpha,
  deepPurple,
  deepPurpleAlpha,
  theme,
  surface,
  feedback,
  system,
  state,
  typographyColors,
  stroke,
  icon,
  radius,
  size,
} from './designSystem';

export type {
  DsColors,
  ThemeColors,
  SurfaceColors,
  FeedbackColors,
  SystemColors,
  StateColors,
  TypographyColors,
  Radius,
  RadiusKey,
  RadiusValue,
  Size,
  SizeKey,
  SizeValue,
} from './designSystem';
