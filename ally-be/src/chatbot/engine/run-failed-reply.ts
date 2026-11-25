import { phoneIn } from './phone-text';
import type { ReplyLanguage } from './reply-language';

/**
 * What a person gets when the agent's run fails or runs out of time (Q3-fast Part 0): a fixed,
 * honest reply in their language, never the old v1 pipeline's answer. It names how to reach the
 * business, taken from the business's own sources (phone and email facts the site reader found or
 * the owner gave) or its helplines, never from its decline wording. With neither, it only asks
 * them to try again.
 */
const WITH_CONTACT: Record<ReplyLanguage, string> = {
  en: "Sorry, I couldn't answer that just now. Please try again, or contact {organisation}: {contact}.",
  hi: 'क्षमा करें, अभी इसका जवाब नहीं दिया जा सका। कृपया फिर से कोशिश करें, या {organisation} से संपर्क करें: {contact}।',
  'hi-latn':
    'Sorry, abhi iska jawab nahi diya ja saka. Please dobara try karein, ya {organisation} se contact karein: {contact}.',
};

const WITHOUT_CONTACT: Record<ReplyLanguage, string> = {
  en: "Sorry, I couldn't answer that just now. Please try again.",
  hi: 'क्षमा करें, अभी इसका जवाब नहीं दिया जा सका। कृपया फिर से कोशिश करें।',
  'hi-latn':
    'Sorry, abhi iska jawab nahi diya ja saka. Please dobara try karein.',
};

export function runFailedReply(
  language: ReplyLanguage,
  organisation: string,
  contact: string | null,
): string {
  const name = organisation.trim();
  if (!contact || !name) return WITHOUT_CONTACT[language];
  return WITH_CONTACT[language]
    .replace('{organisation}', name)
    .replace('{contact}', contact);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The first real phone number in a text (one rule for every reply: `phone-text.ts`). */
export { phoneIn };

export function emailIn(text: string): string | null {
  return text.match(EMAIL)?.[0] ?? null;
}

/** A sourced fact, as far as finding a contact needs it. */
export interface ContactSource {
  section?: string | null;
  text: string;
}

/** Contact details live on these sections first; any other section is searched after them. */
const CONTACT_SECTIONS = ['location', 'about', 'hours'];

/**
 * How to reach the business, from its sources: the first phone number and the first email in its
 * facts (location and about first), else its helplines. Null when it has none of them.
 */
export function contactFromSources(
  facts: ContactSource[],
  helplineNumbers?: string | null,
): string | null {
  const rank = (fact: ContactSource) => {
    const at = CONTACT_SECTIONS.indexOf(fact.section ?? '');
    return at === -1 ? CONTACT_SECTIONS.length : at;
  };
  const ordered = [...facts].sort((a, b) => rank(a) - rank(b));
  let phone: string | null = null;
  let email: string | null = null;
  for (const fact of ordered) {
    phone ??= phoneIn(fact.text);
    email ??= emailIn(fact.text);
    if (phone && email) break;
  }
  const found = [phone, email].filter(Boolean).join(' / ');
  if (found) return found;
  const helplines = helplineNumbers?.trim();
  return helplines && phoneIn(helplines) ? helplines : null;
}

/** Words that mark an emergency or round-the-clock line ("Emergency helpline 99724 99724, 24/7"). */
const EMERGENCY_WORDS =
  /emergenc|24\s*[x×/*]\s*7|round the clock|ambulance|helpline/i;

/**
 * The business's own emergency number for the emergency reply (Q3-fast Part 1, C9; stop 1). Read
 * from its sourced facts and the owner's notes, one sentence at a time: only a sentence that names
 * an emergency, 24x7 or helpline line counts, and the number taken is the first one after that
 * word, never the first number of a general contact list ("Call 080…, 080…, 080…"). Else the
 * owner's helplines when they hold a number. Null when it has neither.
 */
export function emergencyNumberFrom(
  sources: ContactSource[],
  helplineNumbers?: string | null,
): string | null {
  for (const source of sources) {
    for (const sentence of source.text.split(/(?<=[.!?;\n])\s+|\n+/)) {
      const at = sentence.search(EMERGENCY_WORDS);
      if (at < 0) continue;
      const phone = phoneIn(sentence.slice(at));
      if (phone) return phone;
    }
  }
  const helplines = helplineNumbers?.trim();
  return helplines && phoneIn(helplines) ? helplines : null;
}

/** The message is about an animal (Q3-fast stop 1): the emergency reply also says "your nearest vet". */
const ANIMAL =
  /\b(dog|dogs|puppy|cat|cats|kitten|pet|pets|bird|parrot|rabbit|hamster|cow|horse|goat|kutta|kutte|kuttiya|billi|tota)\b|कुत्त|बिल्ली|पालतू/i;

export const aboutAnAnimal = (text: string): boolean => ANIMAL.test(text);
