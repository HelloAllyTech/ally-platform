import type { EntityManager } from 'typeorm';

/**
 * Key facts (Q4 G3): the few facts an assistant must always know, in every run's passages rather
 * than left to search (Round 7 R3: "zero-funds, we don't take money" not found for "₹10,000,
 * 80G?"; 19 of the first Q4 measurement's 40 in-data misses were a contact, hours, fees or what the
 * organisation does). Chosen from what setup learned: the owner's own facts (a template's setup
 * answers) first, then contact, hours, policies, what it does and its services; at most 3 a section,
 * 10 in all and about 500 tokens. They are cited as the "What we learned" document they belong to.
 */

/** One switch to turn key facts off (`AGENT_KEY_FACTS=off`), read when a run is built. */
export const AGENT_KEY_FACTS_ON = (): boolean =>
  (process.env.AGENT_KEY_FACTS ?? '').toLowerCase() !== 'off';

export const KEY_FACTS_MAX = 10;
export const KEY_FACTS_MAX_CHARS = 2000;
const PER_SECTION = 3;
const FACT_MAX_CHARS = 400;
/** The order a section's facts are taken in; brand facts (a logo, a colour) never. */
const ORDER = [
  'location',
  'hours',
  'policies',
  'about',
  'services',
  'faqs',
  'team',
];

export interface KeyFactSource {
  section?: string;
  text?: string;
  sourceUrl?: string;
  byOwner?: boolean;
  correction?: { text?: string } | null;
}

export interface KeyFacts {
  facts: string[];
  /** Each fact's own chunk in the "What we learned" document. */
  chunk_ids: string[];
  document_id?: string;
  title: string;
}

/**
 * Pages whose facts are never key (Q4 G4, Round 7 R3: the privacy page's gmail address used as the
 * contact): legal, privacy, terms, login, app-store and leaderboard pages.
 */
const LOW_VALUE_PAGE =
  /privacy|terms|legal|cookie|disclaimer|login|log-in|sign-?in|sign-?up|account|app-?store|leaderboard|top-?\d+|badges?|data-?deletion/i;
/** The organisation's main pages, whose contact comes first (Q4 G4: a branch's number given). */
const MAIN_PAGE =
  /^\/?$|^\/?(?:contact|contact-us|about|about-us|reach-us|get-in-touch)\/?$/i;

function pagePath(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** The key facts, in the order they're given: owner facts first, then by section. */
export function chooseKeyFacts(facts: KeyFactSource[]): string[] {
  const usable = facts
    .map((f, at) => ({
      at,
      section: f.section ?? 'about',
      owner: Boolean(f.byOwner),
      path: pagePath(f.sourceUrl),
      text: (f.correction?.text ?? f.text ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(
      (f) =>
        f.text &&
        f.section !== 'brand' &&
        (f.owner || f.path === null || !LOW_VALUE_PAGE.test(f.path)),
    );
  const rank = (f: (typeof usable)[number]) =>
    f.owner
      ? -1
      : ORDER.indexOf(f.section) === -1
        ? ORDER.length
        : ORDER.indexOf(f.section);
  // Within a section, the home or contact page's facts first.
  const main = (f: (typeof usable)[number]) =>
    f.path !== null && MAIN_PAGE.test(f.path) ? 0 : 1;
  const sorted = [...usable].sort(
    (a, b) => rank(a) - rank(b) || main(a) - main(b) || a.at - b.at,
  );
  const chosen: string[] = [];
  const seen = new Set<string>();
  const perSection = new Map<string, number>();
  let chars = 0;
  for (const f of sorted) {
    if (chosen.length >= KEY_FACTS_MAX) break;
    const text = f.text.slice(0, FACT_MAX_CHARS);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    const group = f.owner ? 'owner' : f.section;
    if (!f.owner && (perSection.get(group) ?? 0) >= PER_SECTION) continue;
    if (chars + text.length > KEY_FACTS_MAX_CHARS) continue;
    chosen.push(text);
    seen.add(key);
    perSection.set(group, (perSection.get(group) ?? 0) + 1);
    chars += text.length;
  }
  return chosen;
}

/**
 * Only facts with their own chunk (Shehbaz, 23 Nov): a key fact is always a real passage, which a
 * citation names and the checkup's judge reads. One the owner just typed or edited waits for "What
 * we learned" to be indexed again (on save), and search finds it meanwhile. Null when none has one.
 */
export function withChunks(
  facts: string[],
  chunks: { id: string; text: string }[],
  documentId: string | null,
): KeyFacts | null {
  const kept = facts
    .map((fact) => ({ fact, id: chunkOf(fact, chunks) }))
    .filter((k): k is { fact: string; id: string } => k.id !== null);
  if (!kept.length || !documentId) return null;
  return {
    facts: kept.map((k) => k.fact),
    chunk_ids: kept.map((k) => k.id),
    document_id: documentId,
    title: 'What we learned',
  };
}

const squash = (s: string): string =>
  s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The chunk holding a fact: its text contains the fact's first 80 characters. */
export function chunkOf(
  fact: string,
  chunks: { id: string; text: string }[],
): string | null {
  const head = squash(fact)
    .replace(/[.!?;:]$/, '')
    .slice(0, 80);
  return chunks.find((c) => squash(c.text).includes(head))?.id ?? null;
}

/** The assistant's key facts from its draft. Never throws: a failure is no key facts. */
export async function keyFactsFor(
  manager: EntityManager,
  chatbotId: string,
): Promise<KeyFacts | null> {
  try {
    const rows = await manager.query<
      {
        learned: { facts?: KeyFactSource[] } | null;
        document_id: string | null;
      }[]
    >(
      `SELECT learned, source ->> 'learnedFactsDocumentId' AS document_id FROM bot_drafts
        WHERE chatbot_id = $1
        ORDER BY "updatedAt" DESC
        LIMIT 1`,
      [chatbotId],
    );
    const row = rows?.[0];
    const facts = chooseKeyFacts(row?.learned?.facts ?? []);
    if (!facts.length) return null;
    // The facts' own chunks, so a reply cites the real passage and the checkup's judge can read
    // it (with made-up ids it couldn't, and judged details from them invented).
    const chunks = row?.document_id
      ? await manager.query<{ id: string; text: string }[]>(
          `SELECT id, text FROM kb_document_chunks WHERE document_id = $1`,
          [row.document_id],
        )
      : [];
    return withChunks(facts, chunks, row?.document_id ?? null);
  } catch {
    return null;
  }
}
