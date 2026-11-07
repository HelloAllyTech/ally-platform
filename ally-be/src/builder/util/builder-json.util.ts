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

/**
 * One string field from a model's JSON answer that may have been cut off by
 * the token limit — `{"answer": "…` with no closing brace. Falls back to the
 * raw text only when no such field opened at all, so a truncated answer reads
 * as words rather than as a JSON fragment.
 */
export function stringFieldOf(
  text: string | null | undefined,
  field: string,
): string | null {
  const raw = String(text ?? '');
  const parsed = parseJsonObject<Record<string, unknown>>(raw);
  if (parsed && typeof parsed[field] === 'string') {
    return (parsed[field] as string).trim();
  }
  const match = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(
    raw,
  );
  if (!match) return null;
  try {
    return (JSON.parse(`"${match[1]}"`) as string).trim();
  } catch {
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
  }
}
