const { createGlobPatternsForDependencies } = require("@nx/react/tailwind");
const { join } = require("path");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, "{src,pages,components,app}/**/*!(*.stories|*.spec).{ts,tsx,html}"),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  theme: {
    fontFamily: {
      // Serif-only design language: every UI font resolves to IBM Plex Serif.
      // `sans`/`serif` are defined so Tailwind preflight and any `font-sans`
      // utility are serif too; `secondary`/`tertiary` are kept as aliases so the
      // existing `font-secondary` (was Replay Pro) and `font-tertiary` (was
      // Roboto, sans-serif) class usages across the app become serif with no
      // per-file edits. `mono` stays monospaced — code/IDs keep their legibility.
      sans: ["IBM Plex Serif", "serif"],
      serif: ["IBM Plex Serif", "serif"],
      mono: ["IBM Plex Mono", "monospace"],
      primary: ["IBM Plex Serif", "serif"],
      secondary: ["IBM Plex Serif", "serif"],
      tertiary: ["IBM Plex Serif", "serif"],
    },
    fontWeight: {
      // Carbon sets IBM Plex in three weights only — Light 300, Regular 400 and
      // SemiBold 600 — and styles.css self-hosts exactly those faces. `medium`
      // (500) and the heavier steps are aliased to SemiBold so the ~750 existing
      // `font-medium`/`font-bold` usages render a Carbon weight with no per-file
      // edits, the same way `secondary`/`tertiary` were aliased to serif above.
      thin: "300",
      extralight: "300",
      light: "300",
      normal: "400",
      medium: "600",
      semibold: "600",
      bold: "600",
      extrabold: "600",
      black: "600",
    },
    borderRadius: {
      // Carbon is square: buttons, fields, tiles, modals, notifications and data tables
      // all have 0 corners, which is how every @carbon/react component already renders
      // here. The scale below squares the ~850 custom surfaces that sat beside them at
      // 4–8px. `sm` keeps Carbon's 2px for small details (checkbox, popover, tooltip);
      // `full` keeps pills and circles (tags, toggles, avatars, status dots).
      none: "0",
      sm: "2px",
      DEFAULT: "0",
      md: "0",
      lg: "0",
      xl: "0",
      "2xl": "0",
      "3xl": "0",
      full: "9999px",
      // Paired with the consumer app's config for the shared Dropdown / ButtonGroup.
      dropdown: "0",
      "dropdown-item": "0",
      "button-group": "0",
    },
    extend: {
      fontSize: {
        // Type scale. Kept Carbon-compatible: these px steps already line up
        // with IBM Carbon's productive type scale (12/14/16/18/24/28/32), so we
        // leave them intact rather than re-snapping every step — that would
        // reflow dense tables/labels across the app for little visual gain. The
        // Carbon look comes from the serif type family + tokens + component shapes.
        // Custom font sizes used throughout the application
        xs: ["12px", { lineHeight: "16px" }], // Extra small - labels, captions
        chip: "12px", // ui-shared ChipGroup at Carbon's 12px floor (consumer app: 11px)
        sm: ["13px", { lineHeight: "20px" }], // Small - table text, secondary content
        base: ["14px", { lineHeight: "24px" }], // Base - body text, form fields
        md: ["15px", { lineHeight: "24px" }], // Medium - tabs, emphasized text
        lg: ["16px", { lineHeight: "28px" }], // Large - section headers, card titles
        xl: ["18px", { lineHeight: "32px" }], // Extra large - page section titles
        "2xl": ["24px", { lineHeight: "36px" }], // 2X large - page titles, modal headers
        "3xl": ["28px", { lineHeight: "40px" }], // 3X large - large OTP inputs
        "4xl": ["32px", { lineHeight: "44px" }], // 4X large - hero titles, main headers
      },
      colors: {
        /*
         * Mirrors the consumer app's tailwind.config.ts, where the changelog
         * heatmap uses these. Unused in this console today; defined so a
         * shared component naming them resolves in both apps.
         *
         * Heat levels for the changelog's code-activity heatmap: level 0 is a
         * day with no changes, then a one-hue ramp around the blog's terracotta
         * accent, light to dark. A sequential data ramp — each step encodes a
         * magnitude — so it must not re-theme. Checked with the dataviz ordinal
         * validator against gray-50 (the blog's page ground): monotone
         * lightness, visible steps, and the lightest step clears 2:1 against it.
         */
        activity: {
          0: "#EDE9E1",
          1: "#FC8F6C",
          2: "#D76F4C",
          3: "#B34F2C",
          4: "#8F2D02",
        },
        /*
         * Mirrors the consumer app's tailwind.config.ts: the public blog's
         * terracotta accent. Settings → Roadmap shows card notes in `text`, the
         * way the public roadmap page does.
         */
        terracotta: {
          DEFAULT: "#D76F4C",
          text: "#B34F2C",
        },
        // Dropdown and ButtonGroup — the shared ui-shared components' literals, paired
        // with the consumer app's config (which keeps the old values). Here they are
        // Carbon: border-subtle, field-01 and text-helper for the dropdown; the dark
        // segmented group neutralised onto gray-90 / gray-60 / white / text-primary.
        dropdown: {
          border: "#e0e0e0",
          "search-bg": "#f4f4f4",
          "option-active": "#e8e8e8", // layer-hover-01
          empty: "#6f6f6f",
        },
        "button-group": {
          bg: "#262626",
          divider: "#6f6f6f",
          "active-bg": "#ffffff",
          "active-fg": "#161616",
        },
        // Badge — the shared ui-shared/lib/badge component's three variants.
        // These are the exact literals Badge.tsx hardcoded before W4, lifted
        // into tokens unchanged so this console renders identically; the
        // consumer app defines the same names with its own warm values.
        badge: {
          bg: "#FDFDFD",
          fg: "#616161",
          border: "#D5D9EB",
          darkFg: "#1E2025",
          lightBg: "#ECECEC",
          lightFg: "#535353",
        },
        // Primary Colors — Brand Blue (#264D8E), a harmonious ramp anchored on
        // the brand navy at 500/DEFAULT (interactive); 600 is the hover shade,
        // 700 the active shade. Replaces the former Carbon Blue 60 ramp.
        primary: {
          DEFAULT: "#264D8E",
          50: "#EBF0FA", // lightest tint
          100: "#D7E2F4",
          200: "#AEC5EA",
          300: "#7EA2DD",
          400: "#4A7DCF",
          500: "#264D8E", // brand blue (interactive)
          600: "#1F3F75", // hover
          700: "#183059", // active
          800: "#10213C",
          900: "#0A1424",
        },
        // Secondary Colors — IBM Carbon Gray (secondary buttons use Gray 80).
        secondary: {
          DEFAULT: "#393939",
          50: "#f4f4f4", // gray-10
          100: "#e0e0e0", // gray-20
          200: "#c6c6c6", // gray-30
          300: "#a8a8a8", // gray-40
          400: "#8d8d8d", // gray-50
          500: "#6f6f6f", // gray-60
          600: "#525252", // gray-70
          700: "#393939", // gray-80
          800: "#262626", // gray-90
          900: "#161616", // gray-100
        },
        // Destructive/Error Colors — IBM Carbon Red (danger default Red 60).
        destructive: {
          DEFAULT: "#da1e28",
          50: "#fff1f1", // red-10
          100: "#ffd7d9", // red-20
          200: "#ffb3b8", // red-30
          300: "#ff8389", // red-40
          400: "#fa4d56", // red-50
          500: "#da1e28", // red-60 (default)
          600: "#a2191f", // red-70 (hover)
          700: "#750e13", // red-80
          800: "#520408", // red-90
          900: "#2d0709", // red-100
        },
        // Success/Active Colors — IBM Carbon Green (support-success Green 50).
        success: {
          DEFAULT: "#24a148",
          50: "#defbe6", // green-10
          100: "#a7f0ba", // green-20
          200: "#6fdc8c", // green-30
          300: "#42be65", // green-40
          400: "#24a148", // green-50
          500: "#198038", // green-60
          600: "#0e6027", // green-70
          700: "#044317", // green-80
          800: "#022d0d", // green-90
          900: "#071908", // green-100
          light: "#a7f0ba",
          lighter: "#6fdc8c",
          text: "#24a148",
          darkText: "#198038",
        },
        // Warning Colors — IBM Carbon Yellow (support-warning Yellow 30).
        warning: {
          DEFAULT: "#f1c21b",
          50: "#fcf4d6", // yellow-10
          100: "#fddc69", // yellow-20
          200: "#f1c21b", // yellow-30 (default)
          300: "#d2a106", // yellow-40
          400: "#b28600", // yellow-50
          500: "#8e6a00", // yellow-60
          600: "#684e00", // yellow-70
          700: "#483700", // yellow-80
          800: "#302400", // yellow-90
          900: "#1c1500", // yellow-100
          text: "#684e00",
        },
        // Neutral/Gray Colors — IBM Carbon Gray.
        neutral: {
          DEFAULT: "#525252",
          50: "#f4f4f4", // gray-10
          100: "#e0e0e0", // gray-20
          200: "#c6c6c6", // gray-30
          300: "#a8a8a8", // gray-40
          400: "#8d8d8d", // gray-50
          500: "#6f6f6f", // gray-60
          600: "#525252", // gray-70
          700: "#393939", // gray-80
          800: "#262626", // gray-90
          900: "#161616", // gray-100
          950: "#0d0d0d",
        },
        // Scrollbar Colors
        scrollbar: {
          track: "#F1F1F1",
          thumb: "#888888",
          thumbHover: "#555555",
        },
        // Background Colors — IBM Carbon layer tokens (White theme).
        background: {
          DEFAULT: "#ffffff", // background
          secondary: "#f4f4f4", // layer-01 (gray-10)
          tertiary: "#e0e0e0", // layer-02 (gray-20)
        },
        // Tailwind's default hues, re-pointed at Carbon's palettes (~430 usages, mostly
        // status chips and badges). The map is lightness-fitted per family under the
        // constraint that steps stay strictly increasing (so a `bg-*-100` chip never loses
        // its `border-*-200` edge), and for every family the best fit turned out to be the
        // same simple rule: Tailwind N00 -> Carbon N0, 50 -> 10, 100 -> Carbon's 10-hover
        // tint, 950 -> 100. Families without a Carbon twin take the nearest one: amber
        // joins yellow (Carbon's warning hue), sky is cyan, indigo is blue. Every text-on-
        // tint pair in use clears 4.5:1; the 500 step is Carbon's 50, too light for text,
        // so text uses 600 (Carbon's support/error step) and up.
        red: {
          50: "#fff1f1", // red-10
          100: "#ffe0e0", // red-10-hover
          200: "#ffd7d9", // red-20
          300: "#ffb3b8", // red-30
          400: "#ff8389", // red-40
          500: "#fa4d56", // red-50
          600: "#da1e28", // red-60
          700: "#a2191f", // red-70
          800: "#750e13", // red-80
          900: "#520408", // red-90
          950: "#2d0709", // red-100
        },
        orange: {
          50: "#fff2e8", // orange-10
          100: "#ffe2cc", // orange-10-hover
          200: "#ffd9be", // orange-20
          300: "#ffb784", // orange-30
          400: "#ff832b", // orange-40
          500: "#eb6200", // orange-50
          600: "#ba4e00", // orange-60
          700: "#8a3800", // orange-70
          800: "#5e2900", // orange-80
          900: "#3e1a00", // orange-90
          950: "#231000", // orange-100
        },
        amber: {
          50: "#fcf4d6", // yellow-10
          100: "#f8e6a0", // yellow-10-hover
          200: "#fddc69", // yellow-20
          300: "#f1c21b", // yellow-30
          400: "#d2a106", // yellow-40
          500: "#b28600", // yellow-50
          600: "#8e6a00", // yellow-60
          700: "#684e00", // yellow-70
          800: "#483700", // yellow-80
          900: "#302400", // yellow-90
          950: "#1c1500", // yellow-100
        },
        yellow: {
          50: "#fcf4d6", // yellow-10
          100: "#f8e6a0", // yellow-10-hover
          200: "#fddc69", // yellow-20
          300: "#f1c21b", // yellow-30
          400: "#d2a106", // yellow-40
          500: "#b28600", // yellow-50
          600: "#8e6a00", // yellow-60
          700: "#684e00", // yellow-70
          800: "#483700", // yellow-80
          900: "#302400", // yellow-90
          950: "#1c1500", // yellow-100
        },
        green: {
          50: "#defbe6", // green-10
          100: "#b6f6c8", // green-10-hover
          200: "#a7f0ba", // green-20
          300: "#6fdc8c", // green-30
          400: "#42be65", // green-40
          500: "#24a148", // green-50
          600: "#198038", // green-60
          700: "#0e6027", // green-70
          800: "#044317", // green-80
          900: "#022d0d", // green-90
          950: "#071908", // green-100
        },
        teal: {
          50: "#d9fbfb", // teal-10
          100: "#acf6f6", // teal-10-hover
          200: "#9ef0f0", // teal-20
          300: "#3ddbd9", // teal-30
          400: "#08bdba", // teal-40
          500: "#009d9a", // teal-50
          600: "#007d79", // teal-60
          700: "#005d5d", // teal-70
          800: "#004144", // teal-80
          900: "#022b30", // teal-90
          950: "#081a1c", // teal-100
        },
        sky: {
          50: "#e5f6ff", // cyan-10
          100: "#cceeff", // cyan-10-hover
          200: "#bae6ff", // cyan-20
          300: "#82cfff", // cyan-30
          400: "#33b1ff", // cyan-40
          500: "#1192e8", // cyan-50
          600: "#0072c3", // cyan-60
          700: "#00539a", // cyan-70
          800: "#003a6d", // cyan-80
          900: "#012749", // cyan-90
          950: "#061727", // cyan-100
        },
        blue: {
          50: "#edf5ff", // blue-10
          100: "#dbebff", // blue-10-hover
          200: "#d0e2ff", // blue-20
          300: "#a6c8ff", // blue-30
          400: "#78a9ff", // blue-40
          500: "#4589ff", // blue-50
          600: "#0f62fe", // blue-60
          700: "#0043ce", // blue-70
          800: "#002d9c", // blue-80
          900: "#001d6c", // blue-90
          950: "#001141", // blue-100
        },
        indigo: {
          50: "#edf5ff", // blue-10
          100: "#dbebff", // blue-10-hover
          200: "#d0e2ff", // blue-20
          300: "#a6c8ff", // blue-30
          400: "#78a9ff", // blue-40
          500: "#4589ff", // blue-50
          600: "#0f62fe", // blue-60
          700: "#0043ce", // blue-70
          800: "#002d9c", // blue-80
          900: "#001d6c", // blue-90
          950: "#001141", // blue-100
        },
        purple: {
          50: "#f6f2ff", // purple-10
          100: "#ede5ff", // purple-10-hover
          200: "#e8daff", // purple-20
          300: "#d4bbff", // purple-30
          400: "#be95ff", // purple-40
          500: "#a56eff", // purple-50
          600: "#8a3ffc", // purple-60
          700: "#6929c4", // purple-70
          800: "#491d8b", // purple-80
          900: "#31135e", // purple-90
          950: "#1c0f30", // purple-100
        },
        // Border Colors — IBM Carbon border tokens.
        border: {
          DEFAULT: "#e0e0e0", // border-subtle (gray-20)
          light: "#e0e0e0",
          medium: "#c6c6c6", // gray-30
          dark: "#8d8d8d", // gray-50
          blue: "#264D8E", // focus / interactive (brand blue)
          amber400: "#FFCA28",
        },
        // Text colours — Carbon's white-theme text tokens. This group used to be an
        // alpha-black ramp (0.87 … 0.04) carried over from Material UI, whose lighter
        // steps put body text at 1.7–2.7:1 contrast. The steps keep their order but fold
        // onto Carbon's three readable tokens, each ≥ 4.5:1 on white, so the ~3,000
        // existing `text-typography-*` usages re-point with no per-file edits:
        //   900          → text-primary   (gray-100)
        //   800, 700     → text-secondary (gray-70)
        //   600 … 400    → text-helper    (gray-60)
        // Placeholder and disabled text have their own Carbon tokens (alpha of
        // gray-100) rather than borrowing a light step. 50–300 stay translucent: they
        // are hairlines and washes, not text.
        typography: {
          Default: "#161616",
          50: "rgba(22, 22, 22, 0.04)",
          100: "rgba(22, 22, 22, 0.08)",
          200: "rgba(22, 22, 22, 0.12)",
          300: "rgba(22, 22, 22, 0.16)",
          400: "#6f6f6f",
          500: "#6f6f6f",
          600: "#6f6f6f",
          700: "#525252",
          800: "#525252",
          900: "#161616",
          placeholder: "rgba(22, 22, 22, 0.4)", // text-placeholder
          disabled: "rgba(22, 22, 22, 0.25)", // text-disabled
        },
        // Tailwind's default `gray` is a blue-tinted slate; Carbon's is neutral. Mapped
        // by lightness (not by index, as `neutral` above is) so a `bg-gray-50` →
        // `hover:bg-gray-100` pair still steps: 50/100 are layer-01 and its hover.
        // Carbon has no pure black: its darkest neutral is gray-100. Re-pointing `black`
        // keeps text-black at text-primary and makes bg-black/NN scrims Carbon's overlay.
        black: "#161616",
        gray: {
          50: "#f4f4f4", // gray-10 (layer-01)
          100: "#e8e8e8", // gray-10-hover (layer-hover-01)
          200: "#e0e0e0", // gray-20 (border-subtle)
          300: "#c6c6c6", // gray-30
          400: "#a8a8a8", // gray-40
          500: "#6f6f6f", // gray-60 (text-helper)
          600: "#525252", // gray-70 (text-secondary)
          700: "#393939", // gray-80
          800: "#262626", // gray-90
          900: "#161616", // gray-100 (text-primary)
          950: "#161616",
        },
      },
      animation: {
        fadeIn: "fadeIn 0.2s ease-in-out",
        slideInFromRight: "slideInFromRight 0.2s ease-out",
        fadeInOut: "fadeInOut 1.5s ease-in-out infinite",
        // Slow idle "on shift, nothing outstanding" pulse for AgentAvatar —
        // deliberately much slower than the existing `animate-ping` used for
        // "working", so the two presences read as different rhythms rather
        // than the same animation in a different colour.
        breathe: "breathe 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        slideInFromRight: {
          "0%": { opacity: "0", transform: "translateX(10px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        fadeInOut: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.1" },
        },
        breathe: {
          "0%, 100%": { opacity: "0.5", transform: "scale(1)" },
          "50%": { opacity: "0.15", transform: "scale(1.4)" },
        },
      },
    },
  },
  plugins: [],
};
