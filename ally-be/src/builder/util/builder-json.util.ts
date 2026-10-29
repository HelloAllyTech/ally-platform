/**
 * The first JSON object in a model's answer, or null. Models wrap JSON in
 * code fences or a sentence often enough that `JSON.parse(text)` alone fails
 * on answers that are otherwise right; anything that still does not parse is
 * the caller's fallback path, never a thrown error.
 */
export function parseJsonObject<T = Record<string, unknown>>(
  text: string | null | undefined,
): T | null {
  const raw = String(text ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as T)
      : null;
  } catch {
    return null;
  }
}
