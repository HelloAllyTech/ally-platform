import { LearnedSection } from '../enum/bot-draft.enum';
import type { LearnedFact } from '../type/bot-draft.type';

/**
 * Q3-fast Part 2, fix 1 (`docs/agents-v2/Q3A-DIAGNOSIS.md`): the facts setup learned from the
 * site, as a document the assistant searches. Setup reads pages into short, sourced facts that the
 * owner checks and the checkup is written from, but the assistant only searched the raw pages,
 * where a fact like "open 9:00 am - 8:00 pm" sits in a long chunk that ranks low or is split.
 *
 * One section per fact, so each becomes its own short passage: a heading line (the section and
 * the page it came from, which the pasted-text extractor reads as a heading) and the fact,
 * ending in a full stop so it is never read as a heading itself.
 */

export const LEARNED_FACTS_TITLE = 'What we learned';
export const LEARNED_FACTS_TAG = 'learned-facts';
/** Emitted when a draft whose facts are already a document is saved, so the document follows. */
export const LEARNED_FACTS_CHANGED = 'bot-draft.learned-facts-changed';

export interface LearnedFactsChanged {
  chatbotId: string;
  documentId: string;
  facts: LearnedFact[];
  /** Who the update runs as when the save had no signed-in user (a background re-read). */
  ownerUserId: number;
  tenantId: string | null;
}

const LABELS: Record<LearnedSection, string> = {
  [LearnedSection.ABOUT]: 'About',
  [LearnedSection.SERVICES]: 'Services and prices',
  [LearnedSection.HOURS]: 'Hours',
  [LearnedSection.TEAM]: 'Team',
  [LearnedSection.LOCATION]: 'Location and contact',
  [LearnedSection.POLICIES]: 'Policies',
  [LearnedSection.FAQS]: 'Common questions',
  [LearnedSection.BRAND]: 'Brand',
};

/** The extractor's heading rule: ≤ 80 characters, ≤ 10 words, no end punctuation. */
const MAX_HEADING_CHARS = 80;
const MAX_HEADING_WORDS = 10;

/** "Mpower - The Centre, Mumbai | Mpower" → "Mpower The Centre Mumbai". */
function pageName(title: string | null | undefined): string {
  // The site's name usually follows " | " or a long dash; a plain hyphen is part of names.
  const first = (title ?? '').split(/\s[|–—]\s/)[0] ?? '';
  return first
    .replace(/&amp;/g, '&')
    .replace(/[^\p{L}\p{N}&' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function factHeading(fact: LearnedFact): string {
  const label = LABELS[fact.section] ?? 'About';
  const from = fact.byOwner ? 'from the owner' : pageName(fact.sourceTitle);
  const words = `${label}${from ? `, ${from}` : ''}`
    .split(/\s+/)
    .slice(0, MAX_HEADING_WORDS);
  let heading = words.join(' ');
  if (heading.length > MAX_HEADING_CHARS)
    heading = heading.slice(0, MAX_HEADING_CHARS).replace(/\s+\S*$/, '');
  return heading.replace(/[.!?;:,\s]+$/, '');
}

function factLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /[.!?;:]$/.test(line) ? line : `${line}.`;
}

/**
 * The document's text: every fact except the brand ones (a logo or colour answers nothing),
 * in the order learned. Empty when there's nothing to say.
 */
export function learnedFactsText(facts: LearnedFact[]): string {
  return facts
    .filter((f) => f.section !== LearnedSection.BRAND && f.text?.trim())
    .map((f) => `${factHeading(f)}\n${factLine(f.text)}`)
    .join('\n\n');
}
