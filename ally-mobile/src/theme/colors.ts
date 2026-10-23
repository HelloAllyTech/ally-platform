import {dsColors} from './designSystem';

/**
 * Application Colors
 *
 * This file maintains backward compatibility with existing color names
 * while integrating the new design system colors.
 *
 * Structure:
 * 1. Legacy colors (for backward compatibility)
 * 2. Design system colors (new semantic tokens)
 */

// ==================== LEGACY COLORS (Backward Compatibility) ====================

/**
 * @deprecated Use dsColors.neutral.white or design system tokens instead
 * Maintaining for backward compatibility during migration
 */
export const legacyColors = {
  // Whites
  white: '#FFFFFF',
  white2: '#E3E4E5',
  white3: '#FDFDFD',
  white4: '#ECECEC',
  roseWhite: '#FFF0F1',
  whiteTransparent0: 'rgba(255, 255, 255, 0)',
  whiteTransparent10: 'rgba(255, 255, 255, 0.1)',
  whiteTransparent40: 'rgba(255, 255, 255, 0.4)',
  whiteTransparent60: 'rgba(255, 255, 255, 0.6)',
  whiteTransparent90: 'rgba(255, 255, 255, 0.9)',

  // Blacks
  black: '#000000',
  black0: 'rgba(0,0,0,0.1)',
  blackTransparent50: 'rgba(0, 0, 0, 0.5)',

  // Grays - Light to Dark
  lightGray1: '#F8F8F8',
  lightGray9: '#fbfbfb',
  lightGray8: '#F6F6F6',
  lightGray: '#F5F5F5',
  lightGrayWithOpacity: '#F5F5F5BA',
  lightGray2: '#E5E7EB',
  lightGray3: '#676767',
  lightGray4: '#D5D5D5',
  lightGray5: '#DBDBDB',
  lightGray6: 'rgba(229,231,235, 0.2)',
  lightGray7: '#E5E5E5',
  lightGray10: '#C9C9C9',
  lightGray11: '#6C6C6C',
  lightGray12: '#A5A5A5',
  lightGray13: '#898989',
  lightGray14: '#DADCE1',
  lightGray15: '#BFBFBF',
  lightGray16: '#BDBDBD',
  lightGrayD9: '#D9D9D9',
  lightGray17: '#D2D2D2',
  lightGray18: '#021922',
  lightGray19: '#F3F3F3',
  lightGraySubtle: 'rgba(229, 231, 235, 0.1)',
  semiTransparentGray: 'rgba(229, 231, 235, 0.6)',
  ashGray: '#EAEAEA',
  platinumGray: '#E8E8E8',
  paleGray: '#E1E9EE',
  gray: '#7E7E7E',
  gray99: '#999999',
  mediumGray: '#8C8C8C',
  mediumGray2: '#9E9E9E',
  darkGray: 'rgba(2,6,11,0.7)',
  darkGray2: '#222222',
  darkGray3: '#191B1F',
  darkGray4: '#292C33',
  darkGray5: '#1E2025',
  darkGray6: '#525252',
  darkGray7: '#17181A',
  darkGray8: '#797C84',
  darkGray9: '#5A5F6A',
  darkGray10: '#282B31',
  darkGray11: '#242529',
  darkGray12: '#434343',
  darkGray13: '#D3D3D3',
  darkGray14: '#535353',
  darkGray15: '#616161',
  darkGray16: '#656565',
  darkGray17: '#1A1A1A',
  gunmetal: '#424242',
  darkCharcoal: '#4D4D4D',
  charcoal: '#151321',
  charcoal2: '#49454F',
  charcoalBlue: '#1C3C51',
  gunMetal90: 'rgba(23, 24, 26, 0.9)',
  darkSlate: '#292929',
  smokyBlack: 'rgba(19, 19, 19, 0.55)',
  charcoalGray: '#47464F',

  // Blues - Light to Dark
  paleBlue: '#EAFEFE',
  lightCyan: '#DAFFFF',
  lightBlue5: '#DAE9FC',
  lightBlue3: '#BDDBFE',
  powderBlue: '#B7D9FF',
  lightBlue: '#0B1931',
  lightBlue2: '#142B4E',
  lightBlue4: '#406EA3',
  blue: '#1480FB',
  brightBlue: '#0473F2',
  azureBlue: '#0957D0',
  oceanBlue: '#12365E',
  steelBlue: '#072A45',
  darkBlue: '#000B1D',
  darkBlue2: '#0E1724',
  darkBlue3: '#0A1F3C',
  navyGray: '#07131C',
  deepNavy: '#0D0E2A',
  darkNavy: '#03051F',
  nudgeBackground: '#0A1729',
  iceBlue: '#EEF8FF',

  // Greens/Teals
  lightGreen: '#EAFEFE',
  teal: '#4D8779',
  deepTeal: '#1b424f',
  darkGreen: '#1B282F',
  mintGreen: '#DCEBDD',
  emeraldGreen: '#47B881',
  sageGreen: '#BAD4B8',
  jadeGreen: '#26AF6C',
  lightGreen2: 'rgba(232, 245, 233, 0.25)',

  // Reds
  brightRed: '#F93535',
  vividRed: '#F50004',
  coralRed: '#FB6767',
  coralPink: '#FBDED9',
  brickRed: '#E5675A',
  tomatoRed: '#FF5454',
  salmonRed: '#FF8A8A',
  softCoralRed: '#FE6F64',
  lightRed: 'rgba(255, 217, 212, 0.25)',

  // Yellows
  yellow: '#FFD700',
  starYellow: '#FFB800',
  floralWhite: '#FDF8E4',
  creamYellow: '#F8E6BA',
  amberOrange: '#FFAD0D',

  // Orange
  carrotOrange: '#EC930F',

  // Browns
  russetBrown: '#873200',

  // Purples
  deepPurple: '#673AB7',

  // Warning/Alert colors
  warning: '#FFF3CD',
} as const;

// ==================== UNIFIED COLOR EXPORT ====================

/**
 * Unified color palette combining legacy and design system colors
 *
 * Usage:
 * - Prefer dsColors.* for new components (e.g., dsColors.theme.primary)
 * - Legacy names maintained for existing components during migration
 */
export const colors = {
  // Spread legacy colors for backward compatibility
  ...legacyColors,

  // Design system color palettes (Material colors)
  ds: dsColors,
} as const;

// Type exports
export type Colors = typeof colors;
export type LegacyColors = typeof legacyColors;
