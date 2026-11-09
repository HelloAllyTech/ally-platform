import { ImageContext, ImagePersonaContext, ImageSlotProfile, ImageStyle } from "@types";

/** Matches the backend's 3..2000-char description rule. */
export const DESCRIPTION_MIN_LENGTH = 3;
export const DESCRIPTION_MAX_LENGTH = 2000;
/** Enough of a body for the describe step; the rest is noise. */
export const CONTEXT_TEXT_MAX_CHARS = 600;

const LAST_STYLE_KEY = "imageStudio.lastStyleId";

/**
 * Rich text → one plain line for an image request, cut at a word boundary.
 * Self-contained (not ui-shared's htmlToPlainText) so editors whose tests mock
 * ui-shared still render.
 */
export const toContextText = (
  html: string | null | undefined,
  maxChars = CONTEXT_TEXT_MAX_CHARS,
): string => {
  if (!html) return "";
  // textContent runs adjacent blocks together ("…fixing.Reflect…"), so break
  // before every block boundary first.
  const spaced = html.replace(/<(\/(?:p|div|li|h[1-6]|blockquote|td)|br\s*\/?)>/gi, " <$1>");
  const text =
    typeof DOMParser !== "undefined"
      ? (new DOMParser().parseFromString(spaced, "text/html").body.textContent ?? "")
      : spaced.replace(/<[^>]*>/g, " ");
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const cut = collapsed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxChars / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:]+$/, "")}…`;
};

const clean = (value: unknown): string | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

/** Drop empty fields, so the request carries only what the slot actually has. */
export const compactContext = (context: ImageContext | undefined): ImageContext => {
  if (!context) return {};
  const persona: ImagePersonaContext = {};
  Object.entries(context.persona ?? {}).forEach(([key, value]) => {
    const cleaned = clean(value);
    if (cleaned) (persona as Record<string, string>)[key] = cleaned;
  });
  const out: ImageContext = {};
  const title = clean(context.title);
  const text = clean(context.text);
  const courseTitle = clean(context.courseTitle);
  const audience = clean(context.audience);
  if (title) out.title = title;
  if (text) out.text = text;
  if (courseTitle) out.courseTitle = courseTitle;
  if (audience) out.audience = audience;
  if (Object.keys(persona).length > 0) out.persona = persona;
  return out;
};

/** Last style the author generated with, wherever. Storage can be blocked; never throws. */
export const readLastStyleId = (): string | null => {
  try {
    return window.localStorage.getItem(LAST_STYLE_KEY);
  } catch {
    return null;
  }
};

export const writeLastStyleId = (styleId: string) => {
  try {
    window.localStorage.setItem(LAST_STYLE_KEY, styleId);
  } catch {
    // Private window or blocked storage: the default style is fine.
  }
};

/**
 * Which style the gallery opens on: an explicit choice from the caller, then
 * the course's style, then the slot's default, then the last one used.
 * Only ids the gallery actually lists count.
 */
export const pickDefaultStyleId = ({
  styles,
  initialStyleId,
  courseStyleId,
  slotProfile,
  lastStyleId,
}: {
  styles: ImageStyle[];
  initialStyleId?: string | null;
  courseStyleId?: string | null;
  slotProfile?: ImageSlotProfile;
  lastStyleId?: string | null;
}): string | null => {
  const known = new Set(styles.map(style => style.id));
  const candidates = [initialStyleId, courseStyleId, slotProfile?.defaultStyleId, lastStyleId];
  for (const candidate of candidates) {
    if (candidate && known.has(candidate)) return candidate;
  }
  return styles[0]?.id ?? null;
};

/** CSS gradient from a style's two swatch colours. */
export const swatchGradient = (swatch: [string, string] | undefined) =>
  swatch ? `linear-gradient(135deg, ${swatch[0]}, ${swatch[1]})` : undefined;

/** Variation choices the slot allows, capped by the backend's maximum. */
export const VARIATION_OPTIONS = [1, 2, 4] as const;

/**
 * The fallback slotKey for a field that has no id of its own (a form the
 * field can't see the record id of): the page it is on plus the field, so
 * results survive the modal closing and history is per page.
 */
export const pageSlotKey = (slotKind: string, fieldId: string) => {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  return `${slotKind}:page:${path}:${fieldId}`;
};
