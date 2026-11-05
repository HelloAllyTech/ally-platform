/**
 * Design System - Color Tokens
 * Generated from DS-Variables.json
 *
 * This file contains all Material Design color palettes and semantic color tokens.
 * Colors are organized into:
 * - Material: Base color palettes (neutral, red, blue, etc.)
 * - Semantic: Purpose-based tokens (theme, surface, feedback, etc.)
 */

// ==================== MATERIAL COLOR PALETTES ====================

/**
 * Neutral colors - Black and White
 */
export const neutral = {
  black: '#000000',
  white: '#ffffff',
} as const;

/**
 * Red color scale (50-950)
 */
export const red = {
  50: '#ffd9d4',
  100: '#ffc9c1',
  200: '#ffa79c',
  300: '#fe6f64',
  400: '#f93535',
  500: '#f93535',
  600: '#a9554d',
  700: '#97413a',
  800: '#810001',
  900: '#5a0000',
  950: '#390002',
} as const;

/**
 * Pink color scale (50-900 + A100-A700)
 */
export const pink = {
  50: '#fce4ec',
  100: '#f8bbd0',
  200: '#f48fb1',
  300: '#f06292',
  400: '#ec407a',
  500: '#e91e63',
  600: '#d81b60',
  700: '#c2185b',
  800: '#ad1457',
  900: '#880e4f',
  A100: '#ff80ab',
  A200: '#ff4081',
  A400: '#f50057',
  A700: '#c51162',
} as const;

/**
 * Indigo color scale (50-900 + A100-A700)
 */
export const indigo = {
  50: '#e8eaf6',
  100: '#c5cae9',
  200: '#9fa8da',
  300: '#7986cb',
  400: '#5c6bc0',
  500: '#3f51b5',
  600: '#3949ab',
  700: '#303f9f',
  800: '#283593',
  900: '#1a237e',
  A100: '#8c9eff',
  A200: '#536dfe',
  A400: '#3d5afe',
  A700: '#304ffe',
} as const;

/**
 * Blue color scale (50-950)
 */
export const blue = {
  50: '#e2f2ff',
  100: '#b7d7ff',
  200: '#86b8ff',
  300: '#5f99fc',
  400: '#6188c9',
  500: '#0957d0',
  600: '#0957d0',
  700: '#0143a8',
  800: '#123268',
  900: '#10264c',
  950: '#000248',
} as const;

/**
 * Blue Alpha (transparency variations)
 */
export const blueAlpha = {
  25: 'rgba(226, 242, 255, 0.25)',
  50: 'rgba(226, 242, 255, 0.5)',
} as const;

/**
 * Light Blue color scale (50-900 + A100-A700)
 */
export const lightBlue = {
  50: '#e1f5fe',
  100: '#b3e5fc',
  200: '#81d4fa',
  300: '#4fc3f7',
  400: '#29b6f6',
  500: '#03a9f4',
  600: '#039be5',
  700: '#0288d1',
  800: '#0277bd',
  900: '#01579b',
  A100: '#80d8ff',
  A200: '#40c4ff',
  A400: '#00b0ff',
  A700: '#0091ea',
} as const;

/**
 * Cyan color scale (50-900 + A100-A700)
 */
export const cyan = {
  50: '#e0f7fa',
  100: '#b2ebf2',
  200: '#80deea',
  300: '#4dd0e1',
  400: '#26c6da',
  500: '#00bcd4',
  600: '#00acc1',
  700: '#0097a7',
  800: '#00838f',
  900: '#006064',
  A100: '#84ffff',
  A200: '#18ffff',
  A400: '#00e5ff',
  A700: '#00b8d4',
} as const;

/**
 * Green color scale (50-900 + A100-A700)
 */
export const green = {
  50: '#e8f5e9',
  100: '#c8e6c9',
  200: '#a5d6a7',
  300: '#81c784',
  400: '#66bb6a',
  500: '#4caf50',
  600: '#43a047',
  700: '#388e3c',
  800: '#2e7d32',
  900: '#18441b',
  A100: '#b9f6ca',
  A200: '#69f0ae',
  A400: '#00e676',
  A700: '#00c853',
} as const;

/**
 * Light Green color scale (50-900 + A100-A700)
 */
export const lightGreen = {
  50: '#f1f8e9',
  100: '#dcedc8',
  200: '#c5e1a5',
  300: '#aed581',
  400: '#9ccc65',
  500: '#8bc34a',
  600: '#7cb342',
  700: '#689f38',
  800: '#558b2f',
  900: '#33691e',
  A100: '#ccff90',
  A200: '#b2ff59',
  A400: '#76ff03',
  A700: '#64dd17',
} as const;

/**
 * Amber color scale (50-900 + A100-A700)
 */
export const amber = {
  50: '#fff8e1',
  100: '#ffecb3',
  200: '#ffe082',
  300: '#ffd54f',
  400: '#ffca28',
  500: '#ffc107',
  600: '#ffb300',
  700: '#ffa000',
  800: '#ff8f00',
  900: '#ff6f00',
  A100: '#ffe57f',
  A200: '#ffd740',
  A400: '#ffc400',
  A700: '#ffab00',
} as const;

/**
 * Orange color scale (50-900 + A100-A700)
 */
export const orange = {
  50: '#fff3e0',
  100: '#ffe0b2',
  200: '#ffcc80',
  300: '#ffb74d',
  400: '#ffa726',
  500: '#ff9800',
  600: '#fb8c00',
  700: '#f57c00',
  800: '#ef6c00',
  900: '#e65100',
  A100: '#ffd180',
  A200: '#ffab40',
  A400: '#ff9100',
  A700: '#ff6d00',
} as const;

/**
 * Deep Orange color scale (50-900 + A100-A700)
 */
export const deepOrange = {
  50: '#fbe9e7',
  100: '#ffccbc',
  200: '#ffab91',
  300: '#ff8a65',
  400: '#ff7043',
  500: '#ff5722',
  600: '#f4511e',
  700: '#e64a19',
  800: '#d84315',
  900: '#bf360c',
  A100: '#ff9e80',
  A200: '#ff6e40',
  A400: '#ff3d00',
  A700: '#dd2c00',
} as const;

/**
 * Grey color scale (50-950)
 */
export const grey = {
  50: '#fafafa',
  100: '#f5f5f5',
  200: '#eeeeee',
  300: '#e0e0e0',
  400: '#bdbdbd',
  500: '#9e9e9e',
  600: '#757575',
  700: '#616161',
  800: '#424242',
  900: '#212121',
  950: '#17181a',
} as const;

/**
 * Black Alpha (transparency variations)
 */
export const blackAlpha = {
  50: 'rgba(0, 0, 0, 0.04)',
  100: 'rgba(0, 0, 0, 0.08)',
  200: 'rgba(0, 0, 0, 0.12)',
  300: 'rgba(0, 0, 0, 0.16)',
  400: 'rgba(0, 0, 0, 0.24)',
  500: 'rgba(0, 0, 0, 0.32)',
  600: 'rgba(0, 0, 0, 0.38)',
  700: 'rgba(0, 0, 0, 0.54)',
  800: 'rgba(0, 0, 0, 0.6)',
  900: 'rgba(0, 0, 0, 0.87)',
  A100: 'rgba(0, 0, 0, 0.2)',
  A200: 'rgba(0, 0, 0, 0.45)',
  A400: 'rgba(0, 0, 0, 0.7)',
  A700: 'rgba(0, 0, 0, 0.95)',
} as const;

/**
 * White Alpha (transparency variations)
 */
export const whiteAlpha = {
  50: 'rgba(255, 255, 255, 0.04)',
  100: 'rgba(255, 255, 255, 0.08)',
  200: 'rgba(255, 255, 255, 0.12)',
  300: 'rgba(255, 255, 255, 0.16)',
  400: 'rgba(255, 255, 255, 0.24)',
  500: 'rgba(255, 255, 255, 0.32)',
  600: 'rgba(255, 255, 255, 0.38)',
  700: 'rgba(255, 255, 255, 0.54)',
  800: 'rgba(255, 255, 255, 0.6)',
  900: 'rgba(255, 255, 255, 0.87)',
  A100: 'rgba(255, 255, 255, 0.2)',
  A200: 'rgba(255, 255, 255, 0.5)',
  A400: 'rgba(255, 255, 255, 0.7)',
  A700: 'rgba(255, 255, 255, 0.95)',
} as const;

/**
 * Deep Purple color scale (50-900 + A100-A700)
 */
export const deepPurple = {
  50: '#ede7f6',
  100: '#d1c4e9',
  200: '#b39ddb',
  300: '#9575cd',
  400: '#7e57c2',
  500: '#673ab7',
  600: '#5e35b1',
  700: '#512da8',
  800: '#4527a0',
  900: '#311b92',
  A100: '#b388ff',
  A200: '#7c4dff',
  A400: '#651fff',
  A700: '#6200ea',
} as const;

/**
 * Deep Purple Alpha (transparency variations)
 */
export const deepPurpleAlpha = {
  25: 'rgba(237, 231, 246, 0.25)',
  50: 'rgba(237, 231, 246, 0.5)',
} as const;

// ==================== SEMANTIC COLOR TOKENS ====================

/**
 * Theme colors - Primary brand colors
 */
export const theme = {
  primary: blue[500], // '#0957d0'
  primaryLight: blue[300], // '#5f99fc'
  primaryDark: blue[700], // '#0143a8'
  onPrimary: neutral.white,
  onSecondary: neutral.white,
  primaryAccent: indigo.A200, // '#536dfe'
  primaryAccentLight: indigo.A100, // '#8c9eff'
  primaryAccentDark: indigo.A400, // '#3d5afe'
  onPrimaryAccent: neutral.white,
  onSecondaryAccent: neutral.white,
} as const;

/**
 * Brand colors - App identity
 */
export const brand = {
  logo: '#264D8E',
} as const;

/**
 * Surface colors - Backgrounds and surfaces
 */
export const surface = {
  background: grey[50], // '#fafafa'
  surface: neutral.white,
  surfaceVariant: grey[100], // '#f5f5f5'
  onBackground: grey[900], // '#212121'
  onSurface: grey[900], // '#212121'
  onSurfaceVariant: grey[700], // '#616161'
  surfaceTint: blue[500], // '#0957d0'
  surfaceContainerLowest: neutral.white,
  surfaceContainerLow: grey[50], // '#fafafa'
  surfaceContainer: grey[100], // '#f5f5f5'
  surfaceContainerHigh: grey[200], // '#eeeeee'
  surfaceContainerHighest: grey[300], // '#e0e0e0'
} as const;

/**
 * Feedback colors - Error, success, warning, info states
 */
export const feedback = {
  error: red[700], // '#97413a'
  onError: neutral.white,
  errorContainer: red[100], // '#ffc9c1'
  onErrorContainer: red[900], // '#5a0000'
  success: green[700], // '#388e3c'
  onSuccess: neutral.white,
  successContainer: green[100], // '#c8e6c9'
  onSuccessContainer: green[900], // '#18441b'
  warning: amber[700], // '#ffa000'
  onWarning: neutral.black,
  warningContainer: amber[100], // '#ffecb3'
  onWarningContainer: amber[900], // '#ff6f00'
  info: blue[700], // '#0143a8'
  onInfo: neutral.white,
  infoContainer: blue[100], // '#b7d7ff'
  onInfoContainer: blue[900], // '#10264c'
} as const;

/**
 * System colors - System UI elements
 */
export const system = {
  statusBar: blue[700], // '#0143a8'
  appBar: blue[500], // '#0957d0'
  navigationBar: neutral.white,
  dialogBackground: neutral.white,
  scrim: blackAlpha[500], // 'rgba(0, 0, 0, 0.32)'
  overlayLight: whiteAlpha[500], // 'rgba(255, 255, 255, 0.32)'
} as const;

/**
 * State colors - Interactive states (hover, focus, pressed, etc.)
 */
export const state = {
  focusLight: blackAlpha[200], // 'rgba(0, 0, 0, 0.12)'
  pressedLight: blackAlpha[200], // 'rgba(0, 0, 0, 0.12)'
  draggedLight: blackAlpha[100], // 'rgba(0, 0, 0, 0.08)'
  focusDark: whiteAlpha[200], // 'rgba(255, 255, 255, 0.12)'
  pressedDark: whiteAlpha[200], // 'rgba(255, 255, 255, 0.12)'
  draggedDark: whiteAlpha[300], // 'rgba(255, 255, 255, 0.16)'
  disabledContainer: blackAlpha[200], // 'rgba(0, 0, 0, 0.12)'
  disabledContent: blackAlpha[600], // 'rgba(0, 0, 0, 0.38)'
} as const;

/**
 * Typography colors - Text emphasis levels
 */
export const typographyColors = {
  highEmphasis: blackAlpha[900], // 'rgba(0, 0, 0, 0.87)'
  mediumEmphasis: blackAlpha[800], // 'rgba(0, 0, 0, 0.6)'
  lowEmphasis: blackAlpha[600], // 'rgba(0, 0, 0, 0.38)'
  highEmphasisLight: whiteAlpha[900], // 'rgba(255, 255, 255, 0.87)'
  mediumEmphasisLight: whiteAlpha.A400, // 'rgba(255, 255, 255, 0.7)'
  lowEmphasisLight: whiteAlpha.A200, // 'rgba(255, 255, 255, 0.5)'
} as const;

/**
 * Stroke and Icon colors
 */
export const stroke = {
  primary: '#d2d2d2',
  lightGray: '#C8C5D0',
} as const;

export const icon = {
  default: grey[600], // '#757575'
  select: grey[900], // '#212121'
} as const;

// ==================== COMBINED DESIGN SYSTEM COLORS ====================

/**
 * Complete Material Design color system
 * Use these colors throughout your application
 */
export const dsColors = {
  // Material palettes
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

  // Semantic tokens
  theme,
  brand,
  surface,
  feedback,
  system,
  state,
  typography: typographyColors,
  stroke,
  icon,
} as const;

// Type exports for TypeScript autocomplete
export type DsColors = typeof dsColors;
export type ThemeColors = typeof theme;
export type SurfaceColors = typeof surface;
export type FeedbackColors = typeof feedback;
export type SystemColors = typeof system;
export type StateColors = typeof state;
export type TypographyColors = typeof typographyColors;
