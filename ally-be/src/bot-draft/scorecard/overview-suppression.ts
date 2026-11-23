/**
 * The Overview's small-number rule (D8), applied on the server so no client ever receives a
 * count or a quote it should not show: a group of fewer than 5 people is reported only as
 * "fewer than 5", and a verbatim customer message is shown only when at least 5 different
 * people asked it and it carries nothing that identifies one of them.
 */
export const MIN_GROUP = 5;

/** A count the owner may see: the number, or "fewer than 5". */
export type SafeCount = number | { lessThan: typeof MIN_GROUP };

/** 0 is plain (nobody to identify); 1 to 4 is "fewer than 5"; 5 and more is the number. */
export function safeCount(n: number): SafeCount {
  return n > 0 && n < MIN_GROUP ? { lessThan: MIN_GROUP } : n;
}

export interface BreakdownRow {
  key: string;
  count: number;
}

/** A breakdown (language, channel, topic) with every group under 5 suppressed. */
export function suppressBreakdown(
  rows: BreakdownRow[],
): { key: string; count: SafeCount }[] {
  return rows
    .map((r) => ({ key: r.key, count: safeCount(r.count) }))
    .sort((a, b) => countOf(b.count) - countOf(a.count));
}

const countOf = (c: SafeCount) => (typeof c === 'number' ? c : 0);

/** Lower-cased, whitespace collapsed, trailing punctuation dropped: "Do you open Sunday?" matches. */
export function normaliseQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?,;:]+$/g, '')
    .trim();
}

/** Anything that could point at one person: an email, a link, a run of 5+ digits (phone, id). */
const IDENTIFYING =
  /[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/|www\.|(\d[\s\-().]*){5,}/i;

export function looksIdentifying(text: string): boolean {
  return IDENTIFYING.test(text);
}

export interface UnansweredInput {
  text: string;
  contactId: string;
  reason: string;
}

export type UnansweredItem =
  | { kind: 'question'; text: string; count: number }
  | { kind: 'theme'; theme: string; count: SafeCount };

export interface UnansweredOptions {
  /** Most question rows listed. */
  limit?: number;
  /** False: no question is quoted (Ally staff without the owner's grant); all fold into themes. */
  quote?: boolean;
}

/**
 * The top unanswered questions. A question is quoted only when 5 or more different people asked
 * it and it does not look identifying; everything else is folded into theme counts (the reason it
 * went unanswered), each counted in people and itself "fewer than 5" below 5.
 */
export function topUnanswered(
  rows: UnansweredInput[],
  { limit = 5, quote = true }: UnansweredOptions = {},
): UnansweredItem[] {
  const groups = new Map<
    string,
    { text: string; people: Set<string>; rows: UnansweredInput[] }
  >();
  for (const row of rows) {
    const key = normaliseQuestion(row.text);
    if (!key) continue;
    const g = groups.get(key) ?? {
      text: row.text.trim(),
      people: new Set(),
      rows: [],
    };
    g.people.add(row.contactId);
    g.rows.push(row);
    groups.set(key, g);
  }
  const quoted: UnansweredItem[] = [];
  const themed = new Map<string, Set<string>>();
  for (const g of groups.values()) {
    if (quote && g.people.size >= MIN_GROUP && !looksIdentifying(g.text)) {
      quoted.push({ kind: 'question', text: g.text, count: g.rows.length });
    } else {
      for (const r of g.rows) {
        const who = themed.get(r.reason) ?? new Set<string>();
        who.add(r.contactId);
        themed.set(r.reason, who);
      }
    }
  }
  quoted.sort((a, b) => countOf2(b) - countOf2(a));
  const themes: UnansweredItem[] = [...themed.entries()]
    .map(([theme, who]) => ({
      kind: 'theme' as const,
      theme,
      count: safeCount(who.size),
    }))
    .sort((a, b) => countOf2(b) - countOf2(a));
  return [...quoted.slice(0, limit), ...themes];
}

const countOf2 = (i: UnansweredItem) =>
  typeof i.count === 'number' ? i.count : 0;
