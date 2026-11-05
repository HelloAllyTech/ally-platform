import {ms} from 'react-native-size-matters';

export const typography = {
  // Display styles
  display: {
    large: {
      fontSize: ms(56),
      lineHeight: ms(64),
      letterSpacing: -0.25,
    },
    medium: {
      fontSize: ms(32),
      lineHeight: ms(36),
      letterSpacing: ms(-0.6),
    },
    small: {
      fontSize: ms(18),
      lineHeight: ms(24),
      letterSpacing: ms(0.18),
    },
  },

  // Headline styles
  headline: {
    large: {
      fontSize: ms(32),
      lineHeight: ms(40),
      letterSpacing: 0,
    },
    medium: {
      fontSize: ms(28),
      lineHeight: ms(36),
      letterSpacing: 0,
    },
    small: {
      fontSize: ms(24),
      lineHeight: ms(32),
      letterSpacing: 0,
    },
    tiny: {
      fontSize: ms(18),
      lineHeight: ms(24),
      letterSpacing: 0,
    },
    micro: {
      fontSize: ms(14),
      lineHeight: ms(22),
      letterSpacing: 0.2,
    },
    nano: {
      fontSize: ms(12),
      lineHeight: ms(16),
      letterSpacing: 0.2,
    },
  },

  // Body styles
  body: {
    large: {
      fontSize: ms(16),
      lineHeight: ms(24),
      letterSpacing: 0.5,
    },
    medium: {
      fontSize: ms(14),
      lineHeight: ms(22),
      letterSpacing: 0.2,
    },
    small: {
      fontSize: ms(12),
      lineHeight: ms(16),
      letterSpacing: 0.2,
    },
    tiny: {
      fontSize: ms(10),
      lineHeight: ms(14),
      letterSpacing: 0.3,
    },
    micro: {
      fontSize: ms(9),
      lineHeight: ms(10),
      letterSpacing: ms(0.09),
    },
    nano: {
      fontSize: ms(8),
      lineHeight: ms(10),
      letterSpacing: ms(0.08),
    },
  },

  // Label styles
  label: {
    large: {
      fontSize: ms(14),
      lineHeight: ms(22),
      letterSpacing: 0.2,
    },
    medium: {
      fontSize: ms(12),
      lineHeight: ms(20),
      letterSpacing: 0.2,
    },
    small: {
      fontSize: ms(11),
      lineHeight: ms(16),
      letterSpacing: 0.5,
    },
    tiny: {
      fontSize: ms(10),
      lineHeight: ms(14),
      letterSpacing: 0.3,
    },
    micro: {
      fontSize: ms(9),
      lineHeight: ms(10),
      letterSpacing: ms(0.09),
    },
    nano: {
      fontSize: ms(8),
      lineHeight: ms(10),
      letterSpacing: ms(0.08),
    },
  },
} as const;

export const fontWeights = {
  thin: 100,
  extraLight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semiBold: 600,
  bold: 700,
  extraBold: 800,
  black: 900,
} as const;

export type TypographyStyle = typeof typography;
export type FontWeight = keyof typeof fontWeights;
