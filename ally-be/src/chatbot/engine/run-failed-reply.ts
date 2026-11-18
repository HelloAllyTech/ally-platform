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

/** A phone number: an optional +, then at least 8 digits with spaces, dashes or brackets. */
const PHONE = /\+?\d[\d\s\-()]{6,}\d/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The first real phone number in a text, or null. Years and prices have too few digits. */
export function phoneIn(text: string): string | null {
  for (const match of text.match(PHONE) ?? []) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 13) return match.trim();
  }
  return null;
}

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
