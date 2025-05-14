import {ms} from 'react-native-size-matters';

export const typography = {
  // Display styles
  display: {
    large: {
      fontSize: ms(57),
      lineHeight: ms(64),
      letterSpacing: -0.25,
      fontWeight: '400',
    },
    medium: {
      fontSize: ms(45),
      lineHeight: ms(52),
      letterSpacing: 0,
      fontWeight: '400',
    },
    small: {
      fontSize: ms(36),
      lineHeight: ms(44),
      letterSpacing: 0,
      fontWeight: '400',
    },
  },

  // Headline styles
  headline: {
    large: {
      fontSize: ms(32),
      lineHeight: ms(40),
      letterSpacing: 0,
      fontWeight: '400',
    },
    medium: {
      fontSize: ms(28),
      lineHeight: ms(36),
      letterSpacing: 0,
      fontWeight: '400',
    },
    small: {
      fontSize: ms(24),
      lineHeight: ms(32),
      letterSpacing: 0,
      fontWeight: '400',
    },
  },

  // Body styles
  body: {
    large: {
      fontSize: ms(16),
      lineHeight: ms(24),
      letterSpacing: 0.5,
      fontWeight: '400',
    },
    medium: {
      fontSize: ms(14),
      lineHeight: ms(20),
      letterSpacing: 0.25,
      fontWeight: '400',
    },
    small: {
      fontSize: ms(12),
      lineHeight: ms(16),
      letterSpacing: 0.4,
      fontWeight: '400',
    },
  },

  // Label styles
  label: {
    large: {
      fontSize: ms(14),
      lineHeight: ms(20),
      letterSpacing: 0.1,
      fontWeight: '500',
    },
    medium: {
      fontSize: ms(12),
      lineHeight: ms(16),
      letterSpacing: 0.5,
      fontWeight: '500',
    },
    small: {
      fontSize: ms(11),
      lineHeight: ms(16),
      letterSpacing: 0.5,
      fontWeight: '500',
    },
  },
} as const;

export type TypographyStyle = typeof typography;
