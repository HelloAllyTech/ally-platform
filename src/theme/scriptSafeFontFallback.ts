import type {ReactNode} from 'react';
import {Platform, Text, TextInput, TextStyle} from 'react-native';

/**
 * Legacy half of the Indic-glyph fix, for Android 7–9 only.
 *
 * Every bundled font is Latin-only (see `scriptSafeFont` in ./fonts), and Android
 * gives a typeface loaded from assets no fallback chain, so on ROMs that don't
 * cover for us — Samsung One UI and Xiaomi MIUI, per field reports — Devanagari,
 * Tamil and Kannada draw as blank space or tofu. Android 10+ is fixed properly and
 * natively: `ScriptFallbackFonts.kt` registers each family with a bundled Noto Sans
 * fallback per script, which keeps brand type on Latin even inside a mixed string.
 * `Typeface.CustomFallbackBuilder` needs API 29, though, and minSdk here is 24.
 *
 * So below API 29 this stands in: it intercepts `Text`/`TextInput` rendering and
 * moves any element whose own text carries one of those scripts onto the platform
 * font, which always has the fallback chain. Coarser than the native path (the
 * whole element moves, not the Indic run) but it keeps the app readable. Latin text
 * is untouched either way.
 *
 * iOS needs none of this — CoreText cascades to a system font per glyph.
 *
 * Delete this when minSdk reaches 29.
 */

// Devanagari (0900) through Sinhala (0DFF) covers every Indian script the platform
// serves today; the trailing ranges are the Vedic marks and Devanagari Extended.
const UNSUPPORTED_SCRIPTS = /[ऀ-෿᳐-᳿꠰-ꣿ]/;

const SYSTEM_FONT_FAMILY = 'sans-serif';

// Weight and slant that our font names encode rather than declaring as style
// props — carried over by hand so dropping the family doesn't flatten hierarchy.
const STYLE_FROM_FAMILY_NAME: ReadonlyArray<readonly [RegExp, TextStyle]> = [
  [/BoldItalic/i, {fontWeight: 'bold', fontStyle: 'italic'}],
  [/Italic/i, {fontStyle: 'italic'}],
  [/Bold/i, {fontWeight: 'bold'}],
  [/Medium/i, {fontWeight: '500'}],
  [/ExtraLight/i, {fontWeight: '200'}],
];

const containsUnsupportedScript = (value: unknown): boolean => {
  if (typeof value === 'string') return UNSUPPORTED_SCRIPTS.test(value);
  if (Array.isArray(value)) return value.some(containsUnsupportedScript);
  // A nested <Text> is intercepted on its own render, so don't walk into elements.
  return false;
};

// StyleSheet.create returns the style objects themselves on this RN version, so a
// local flatten is enough — and it keeps this independent of StyleSheet mocks.
const flattenStyle = (style: unknown): TextStyle => {
  if (Array.isArray(style)) {
    return style.reduce<TextStyle>(
      (merged, entry) => Object.assign(merged, flattenStyle(entry)),
      {},
    );
  }
  if (style && typeof style === 'object') return style as TextStyle;
  return {};
};

const onPlatformFont = (style: unknown): TextStyle => {
  const {fontFamily, ...rest} = flattenStyle(style);
  const inherited = fontFamily
    ? STYLE_FROM_FAMILY_NAME.find(([pattern]) => pattern.test(fontFamily))?.[1]
    : undefined;

  return {
    ...rest,
    // Set rather than removed: a nested <Text> would otherwise inherit the
    // parent's Latin-only family from the native side and still draw blank.
    fontFamily: SYSTEM_FONT_FAMILY,
    ...(inherited &&
    rest.fontWeight === undefined &&
    rest.fontStyle === undefined
      ? inherited
      : null),
  };
};

interface ForwardRefComponent {
  render?: (props: {style?: unknown}, ref: unknown) => ReactNode;
}

const patch = (
  component: unknown,
  holdsUnsupportedText: (props: Record<string, unknown>) => boolean,
): void => {
  const target = component as ForwardRefComponent;
  const original = target.render;
  // RN internals changed shape — leave rendering alone rather than break the app.
  if (typeof original !== 'function') return;

  target.render = function scriptSafeRender(props, ref) {
    if (!holdsUnsupportedText(props as Record<string, unknown>)) {
      return original.call(this, props, ref);
    }
    return original.call(
      this,
      {...props, style: onPlatformFont(props.style)},
      ref,
    );
  };
};

interface ScriptSafeFontTargets {
  text?: unknown;
  textInput?: unknown;
}

// Below this, Typeface.CustomFallbackBuilder does not exist and ScriptFallbackFonts
// cannot register anything — see the note at the top of this file.
const NATIVE_FALLBACK_API_LEVEL = 29;

let installed = false;

/**
 * Install the fallback. Call once, before anything renders. A no-op on iOS and on
 * Android 10+, where the native registration handles this better.
 *
 * `targets` exists for tests: React Native's jest preset swaps `Text`/`TextInput`
 * for class mocks that merely copy statics, so a test has to hand in the real
 * components (`jest.requireActual`) to exercise this against what ships.
 */
export const installScriptSafeFontFallback = (
  targets: ScriptSafeFontTargets = {text: Text, textInput: TextInput},
): void => {
  if (installed || Platform.OS !== 'android') return;
  if (Number(Platform.Version) >= NATIVE_FALLBACK_API_LEVEL) return;
  installed = true;

  patch(targets.text, props => containsUnsupportedScript(props.children));
  patch(targets.textInput, props =>
    containsUnsupportedScript([
      props.value,
      props.defaultValue,
      props.placeholder,
    ]),
  );
};
