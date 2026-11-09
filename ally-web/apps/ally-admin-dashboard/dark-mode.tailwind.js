/* global module */
/**
 * Dark mode for the admin console, layered onto tailwind.config.js without touching any of the
 * ~8,000 colour classes in the app.
 *
 * How it works: the colour steps listed below stop being fixed hex values and become CSS
 * variables. `:root` holds the light value (exactly the hex tailwind.config.js already had, so
 * light mode renders as before) and `html.dark` holds the dark one. The top-bar switch
 * (hooks/useColorMode.ts) only toggles that `dark` class on <html>.
 *
 * Text, background and border are themed SEPARATELY, because one class name means different
 * things in each role: `bg-gray-900` is a dark surface that must stay dark, while
 * `text-gray-900` is body text that must turn light. Same for `bg-white` (a card: goes dark) vs
 * `text-white` (label on a blue button: stays white), and `bg-red-600` (a solid button: stays)
 * vs `bg-red-50` (a tinted chip: becomes a dark wash) vs `text-red-700` (chip text: turns light).
 *
 * Dark values come from Carbon's Gray 100 theme (background #161616, layer #262626, border
 * #393939, text #f4f4f4 / #c6c6c6 / #a8a8a8) so the Tailwind surfaces match the Carbon
 * components, which switch on the same class (`cds--g100`).
 */

/* ------------------------------------------------------------------------------------------ */
/* Dark values                                                                                 */
/* ------------------------------------------------------------------------------------------ */

const lightAlpha = a => `rgba(244, 244, 244, ${a})`;

/** Neutral ramps used as SURFACES (bg, border, ring, divide): low steps become dark layers. */
const neutralSurface = {
  50: "#262626", // layer-01
  100: "#333333", // layer-hover-01
  200: "#393939", // border-subtle / layer-02
  300: "#525252",
  400: "#6f6f6f",
  500: "#8d8d8d",
  600: "#6f6f6f",
  700: "#525252",
  800: "#393939",
  900: "#262626",
  950: "#161616",
};

/** Neutral ramps used as TEXT: dark steps turn light; light steps (already on dark surfaces) stay. */
const neutralText = {
  500: "#a8a8a8", // text-helper
  600: "#c6c6c6", // text-secondary
  700: "#c6c6c6",
  800: "#e0e0e0",
  900: "#f4f4f4", // text-primary
  950: "#f4f4f4",
};

/** Surface roles: background-color, border, ring, divide, gradients, outline. */
const surface = {
  white: { DEFAULT: "#161616" },
  background: { DEFAULT: "#161616", secondary: "#262626", tertiary: "#393939" },
  border: {
    DEFAULT: "#393939",
    light: "#393939",
    medium: "#525252",
    dark: "#6f6f6f",
    blue: "#7EA2DD",
  },
  typography: {
    Default: "#f4f4f4",
    50: lightAlpha(0.04),
    100: lightAlpha(0.08),
    200: lightAlpha(0.12),
    300: lightAlpha(0.16),
    400: "#6f6f6f",
    500: "#6f6f6f",
    600: "#6f6f6f",
    700: "#525252",
    800: "#525252",
    // A filled dark chip/button with white text in light mode; stays a dark fill.
    900: "#393939",
    placeholder: lightAlpha(0.4),
    disabled: lightAlpha(0.25),
  },
  gray: neutralSurface,
  neutral: neutralSurface,
  secondary: { 50: "#262626", 100: "#393939" },
  // Brand tints (selected rows, active nav) become navy washes; 400+ are solid fills and stay.
  primary: { 50: "#14243f", 100: "#1a2f52", 200: "#213b66", 300: "#2f5291" },
  dropdown: {
    border: "#393939",
    "search-bg": "#262626",
    "option-active": "#333333",
    empty: "#a8a8a8",
  },
  badge: {
    bg: "#262626",
    fg: "#c6c6c6",
    border: "#525252",
    darkFg: "#f4f4f4",
    lightBg: "#393939",
    lightFg: "#c6c6c6",
  },
  scrollbar: { track: "#262626", thumb: "#6f6f6f", thumbHover: "#8d8d8d" },
};

/** Text role (`text-*` only). */
const text = {
  // Labels on solid buttons. Kept static so they stay white in both modes.
  white: { DEFAULT: "#ffffff" },
  black: { DEFAULT: "#f4f4f4" },
  typography: {
    Default: "#f4f4f4",
    50: lightAlpha(0.04),
    100: lightAlpha(0.08),
    200: lightAlpha(0.12),
    300: lightAlpha(0.16),
    400: "#a8a8a8",
    500: "#a8a8a8",
    600: "#a8a8a8",
    700: "#c6c6c6",
    800: "#c6c6c6",
    900: "#f4f4f4",
    placeholder: lightAlpha(0.4),
    disabled: lightAlpha(0.25),
  },
  gray: neutralText,
  neutral: { DEFAULT: "#c6c6c6", ...neutralText },
  // Brand-blue text and links: the light ramp, readable on #161616 (7:1).
  primary: {
    DEFAULT: "#7EA2DD",
    500: "#7EA2DD",
    600: "#7EA2DD",
    700: "#AEC5EA",
    800: "#D7E2F4",
    900: "#EBF0FA",
  },
  dropdown: { empty: "#a8a8a8" },
  badge: { fg: "#c6c6c6", darkFg: "#f4f4f4", lightFg: "#c6c6c6" },
};

/** Border role (`border-*` only), where it differs from the surface role. */
const border = {
  // Strong hairlines (1px "ink" borders); a dark surface value would vanish.
  typography: { 900: "#c6c6c6", Default: "#c6c6c6" },
  // Focus/selected borders in brand blue: lift them so they read on #161616.
  primary: { DEFAULT: "#4A7DCF", 500: "#4A7DCF", 600: "#4A7DCF" },
};

/**
 * Status hues (red, green, blue…): the pastel tints become dark washes, dark text steps turn
 * light, and the solid middle steps (400–600 — buttons with white labels) stay as they are.
 * `light` is the colour family as tailwind.config.js defines it.
 */
const hueRamp = light => {
  const top = light[950] ? 950 : 900;
  const bg =
    top === 950
      ? { 50: light[950], 100: light[900], 200: light[800], 300: light[700] }
      : { 50: light[900], 100: light[800], 200: light[700] };
  const txt = {
    500: light[400],
    600: light[400],
    700: light[300],
    800: light[200],
    900: light[200],
    ...(top === 950 ? { 950: light[100] } : {}),
  };
  return { bg, txt };
};

const HUE_FAMILIES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "green",
  "teal",
  "sky",
  "blue",
  "indigo",
  "purple",
  "destructive",
  "success",
  "warning",
];

/** One-off named steps in the status families. */
const hueExtras = {
  surface: { success: { light: "#044317", lighter: "#0e6027" } },
  text: {
    destructive: { DEFAULT: "#ff8389" },
    success: { DEFAULT: "#42be65", text: "#42be65", darkText: "#42be65" },
    warning: { text: "#f1c21b" },
  },
};

/* ------------------------------------------------------------------------------------------ */
/* Wiring                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const HEX = /^#([0-9a-f]{6})$/i;

/** `#rrggbb` → `r g b`, so `bg-white/80` style opacity modifiers keep working. */
const channels = hex => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = typeof v === "object" ? merge(out[k] || {}, v) : v;
  }
  return out;
};

/**
 * Re-point every listed colour step at a CSS variable, keeping the light value in `:root`.
 * Returns the Tailwind colour object for that role plus the variables it needs.
 */
const buildRole = (role, darkMap, lightColors) => {
  const palette = {};
  const lightVars = {};
  const darkVars = {};
  for (const [group, steps] of Object.entries(darkMap)) {
    for (const [step, dark] of Object.entries(steps)) {
      const lightGroup = lightColors[group];
      const light =
        typeof lightGroup === "string"
          ? lightGroup
          : (lightGroup?.[step] ?? (step === "DEFAULT" ? lightGroup?.DEFAULT : undefined));
      if (!light) continue; // a step the light palette doesn't define: nothing to theme
      const name = `--ally-${role}-${group}-${step}`;
      const bothHex = HEX.test(light) && HEX.test(dark);
      lightVars[name] = bothHex ? channels(light) : light;
      darkVars[name] = bothHex ? channels(dark) : dark;
      palette[group] = palette[group] || {};
      palette[group][step] = bothHex ? `rgb(var(${name}) / <alpha-value>)` : `var(${name})`;
    }
  }
  return { palette, lightVars, darkVars };
};

/**
 * Takes the admin Tailwind config and returns it with dark mode wired in. Light mode output is
 * unchanged: every variable's `:root` value is the hex the config already had.
 */
function withDarkMode(config) {
  const lightColors = {
    white: "#ffffff",
    black: "#161616",
    ...config.theme.extend.colors,
  };

  const hueSurface = {};
  const hueText = {};
  for (const family of HUE_FAMILIES) {
    const { bg, txt } = hueRamp(lightColors[family]);
    hueSurface[family] = bg;
    hueText[family] = txt;
  }

  const surfaceRole = buildRole(
    "bg",
    merge(merge(surface, hueSurface), hueExtras.surface),
    lightColors,
  );
  const textRole = buildRole("text", merge(merge(text, hueText), hueExtras.text), lightColors);
  // Borders follow the surface role except where `border` says otherwise.
  const borderRole = buildRole("border", border, lightColors);

  // `white`/`black` are bare strings in Tailwind, not ramps: unwrap them after building.
  const unwrap = palette => {
    const out = { ...palette };
    for (const key of ["white", "black"]) if (out[key]) out[key] = out[key].DEFAULT;
    return out;
  };

  // Surface values replace the base palette, so bg, ring, divide, outline and gradients all
  // follow; `black` is left static (scrims, shadows). Text and border get their own overrides.
  const surfacePalette = { ...surfaceRole.palette };
  delete surfacePalette.white;
  const colors = merge(config.theme.extend.colors, surfacePalette);
  colors.white = unwrap(surfaceRole.palette).white;
  // Text falls back to the ORIGINAL static palette, not the surface one: an un-listed step like
  // `text-gray-100` is light text on a dark panel and must stay light.
  const textColor = merge(config.theme.extend.colors, unwrap(textRole.palette));

  return {
    ...config,
    // Tailwind prunes base rules whose class never appears in the scanned source; the `dark`
    // class is only ever added at runtime, so keep its block explicitly.
    safelist: [...(config.safelist || []), "dark"],
    theme: {
      ...config.theme,
      extend: {
        ...config.theme.extend,
        colors,
        textColor,
        borderColor: borderRole.palette,
      },
    },
    plugins: [
      ...(config.plugins || []),
      ({ addBase }) =>
        addBase({
          ":root": {
            ...surfaceRole.lightVars,
            ...textRole.lightVars,
            ...borderRole.lightVars,
          },
          "html.dark": {
            ...surfaceRole.darkVars,
            ...textRole.darkVars,
            ...borderRole.darkVars,
          },
        }),
    ],
  };
}

module.exports = { withDarkMode };
