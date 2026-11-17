/**
 * Fencing for untrusted content (plan §8, docs/pm-agent.md "Principles").
 *
 * Tool results carry learner text, interview notes, code comments, PR text and telemetry —
 * anything in them that reads like an instruction is DATA. Each result is wrapped in a
 * `<tool_data>` element whose attributes are ours, and every tag-like sequence inside that could
 * close the fence or open a fake system/instruction block is neutralised, so the content can
 * never end the fence early. The lane prompts say what the fence means.
 */

const TAG_LIKE =
  /<\s*\/?\s*(tool_data|untrusted|system|instructions?|assistant|user|human|admin_feedback|memory|exemplar)\b/gi;

/** Neutralise anything that could open or close one of our fences. */
export function neutralise(text: string): string {
  return String(text ?? '').replace(TAG_LIKE, (match) =>
    match.replace('<', '‹'),
  );
}

/** Bounded, then fenced. `attrs` values are ours (ids, source names), never content. */
export function fence(
  tag: 'tool_data' | 'admin_feedback' | 'memory' | 'exemplar',
  attrs: Record<string, string>,
  body: string,
  maxChars: number,
): string {
  const safeAttrs = Object.entries(attrs)
    .map(
      ([key, value]) =>
        `${key}="${String(value)
          .replace(/[^\w .:/@-]/g, '')
          .slice(0, 120)}"`,
    )
    .join(' ');
  let content = neutralise(body);
  if (content.length > maxChars) {
    content = `${content.slice(0, maxChars)}… [truncated — narrow the lookup]`;
  }
  return `<${tag} ${safeAttrs} trust="untrusted-data">\n${content}\n</${tag}>`;
}

/** Instruction-shaped text a candidate card must never carry (it becomes Builder's brief). */
export const INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts?|rules)\b/i,
  /\bdisregard\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|system)\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(?:system|developer)\s+prompt\b/i,
  /\bnew\s+instructions\s*:/i,
  /\bdo\s+not\s+(?:tell|inform)\s+the\s+(?:admin|user|reviewer)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Shrink an aggregate to what fits a prompt without misrepresenting it: long arrays are cut and
 * SAY SO (series keep their tail, rankings their head), floats are rounded. Same rules the
 * retired Suggestions payload used, kept here so this module owns its copy.
 */
const SERIES_KEYS = ['bucket', 'date', 'month', 'period', 'week', 'day'];

export function compact(
  value: unknown,
  limits: { seriesPoints: number; listRows: number } = {
    seriesPoints: 12,
    listRows: 10,
  },
): unknown {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Number(value.toFixed(2));
  }
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 400
      ? `${value.slice(0, 400)}…`
      : value;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    const series =
      !!first &&
      typeof first === 'object' &&
      !Array.isArray(first) &&
      SERIES_KEYS.some((key) => key in (first as Record<string, unknown>));
    const cap = series ? limits.seriesPoints : limits.listRows;
    if (value.length <= cap) return value.map((item) => compact(item, limits));
    const kept = series ? value.slice(-cap) : value.slice(0, cap);
    return {
      _note: series
        ? `showing the latest ${cap} of ${value.length} periods`
        : `showing the top ${cap} of ${value.length} rows`,
      items: kept.map((item) => compact(item, limits)),
    };
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = compact(item, limits);
  }
  return out;
}
