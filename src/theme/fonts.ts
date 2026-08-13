/**
 * Every bundled font here ships Latin glyphs only — none covers Devanagari, Tamil or
 * Kannada. Two things make that safe to ignore at the call site, and both key off the
 * family names below, so keep them in step when adding or renaming a font:
 *
 * - Android 10+: `ScriptFallbackFonts.kt` registers each of these names with a
 *   bundled Noto Sans fallback per script (`android/app/src/main/assets/fonts/`).
 * - Android 7–9: `./scriptSafeFontFallback` moves Indic text to the platform font.
 */
export const fontFamily = {
  REPLAY_PRO: {
    HEADLINE: {
      fontFamily: 'ReplayPro-Headline',
    },
    BOLD_ITALIC: {
      fontFamily: 'ReplayPro-BoldItalic',
    },
    BOLD: {
      fontFamily: 'ReplayPro-Bold',
    },
  },
  ROBOTO: {
    REGULAR: {
      fontFamily: 'Roboto-Regular',
    },
    EXTRA_LIGHT: {
      fontFamily: 'Roboto-ExtraLight',
    },
  },
  IBM_PLEX_SERIF: {
    REGULAR: {
      fontFamily: 'IBMPlexSerif-Regular',
    },
    MEDIUM: {
      fontFamily: 'IBMPlexSerif-Medium',
    },
  },
  YESEVA_ONE: {
    REGULAR: {
      fontFamily: 'YesevaOne-Regular',
    },
  },
};
