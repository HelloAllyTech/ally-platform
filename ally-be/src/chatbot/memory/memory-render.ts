import { MemorySection } from '../entity/memory-entry.entity';

/** The block's budget in characters: lines past it are left out, oldest first (chunk 8a). */
export const MEMORY_BUDGET_CHARS = 1500;

/** Open items first (what's still to do), then preferences, then context. */
const ORDER: MemorySection[] = [
  MemorySection.OPEN_ITEMS,
  MemorySection.PREFERENCES,
  MemorySection.CONTEXT,
];

const HEADINGS: Record<MemorySection, string> = {
  [MemorySection.OPEN_ITEMS]: 'Still open',
  [MemorySection.PREFERENCES]: 'Preferences',
  [MemorySection.CONTEXT]: 'Context',
};

export interface RenderableLine {
  id: string;
  section: MemorySection;
  text: string;
  /** When the person last said it. */
  saidAt: Date;
}

export interface RenderedMemory {
  /** The block the agent reads; "" when there are no lines. */
  text: string;
  /** Short id → line id, for the run's `replace`, `done` and `forget`. */
  refs: Record<string, string>;
}

const dateOf = (at: Date, timeZone?: string): string => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone,
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
};

/**
 * What the agent is shown about one person: their active lines by section, each with a short id
 * (`m1`, `m2`…) and the date they said it, newest first within the budget. The one rendering of
 * these rows: 4a shows the same text to the agent as `/contacts/<id>/USER.md`.
 *
 * Within the budget, lines are kept newest first across sections; then they're printed in section
 * order. The short ids follow the printed order, so `m1` is the first line the agent reads.
 */
export function renderMemory(
  lines: readonly RenderableLine[],
  options: { budget?: number; timeZone?: string } = {},
): RenderedMemory {
  const budget = options.budget ?? MEMORY_BUDGET_CHARS;
  const newestFirst = [...lines].sort(
    (a, b) => b.saidAt.getTime() - a.saidAt.getTime(),
  );
  const kept = new Set<string>();
  let used = 0;
  for (const line of newestFirst) {
    // The id and date take about 20 characters; a heading about 15.
    const cost = line.text.length + 22;
    if (used + cost > budget) continue;
    used += cost;
    kept.add(line.id);
  }
  const out: string[] = [];
  const refs: Record<string, string> = {};
  let n = 0;
  for (const section of ORDER) {
    const inSection = newestFirst.filter(
      (l) => l.section === section && kept.has(l.id),
    );
    if (!inSection.length) continue;
    out.push(`${HEADINGS[section]}:`);
    for (const line of inSection) {
      const ref = `m${++n}`;
      refs[ref] = line.id;
      out.push(
        `- ${ref} (${dateOf(line.saidAt, options.timeZone)}): ${line.text}`,
      );
    }
  }
  return { text: out.join('\n'), refs };
}
