import type { ReplyLanguage } from '../engine/reply-language';

/**
 * Stage 4: the fixed notice at the start of every conversation, on every channel (bot page per
 * conversation, WhatsApp on a contact's first message, the widget), and the reminder when a person
 * from the organisation joins a chat. Pure: no I/O.
 *
 * The owner may reword the notice (`disclaimerText`), but the meaning check keeps "an AI, and people
 * at the organisation, may read this chat" in it; wording that loses that is refused at save.
 */

// COPY: needs approval
export const AI_NOTICE: Record<ReplyLanguage, string> = {
  en: 'You are chatting with an AI assistant. The AI and people at {organisation} may read this chat.',
  hi: 'आप एक एआई सहायक से बात कर रहे हैं। एआई और {organisation} के लोग यह चैट पढ़ सकते हैं।',
  'hi-latn':
    'Aap ek AI assistant se baat kar rahe hain. AI aur {organisation} ke log yeh chat padh sakte hain.',
};

// COPY: needs approval
export const PERSON_JOINED_NOTICE: Record<ReplyLanguage, string> = {
  en: 'A person from {organisation} has joined this chat. They and the AI can read this conversation.',
  hi: '{organisation} से एक व्यक्ति इस चैट में शामिल हुए हैं। वे और एआई यह बातचीत पढ़ सकते हैं।',
  'hi-latn':
    '{organisation} se ek vyakti is chat mein shamil hue hain. Woh aur AI yeh baatcheet padh sakte hain.',
};

// COPY: needs approval
export const NOTICE_MEANING_REFUSED =
  'The notice must still say that an AI and people at your organisation may read the chat.';

const fillOrg = (text: string, organisation?: string | null) =>
  text.replace(/\{organisation\}/g, organisation?.trim() || 'the organisation');

export function aiNotice(
  language: ReplyLanguage,
  organisation?: string | null,
): string {
  return fillOrg(AI_NOTICE[language] ?? AI_NOTICE.en, organisation);
}

export function personJoinedNotice(
  language: ReplyLanguage,
  organisation?: string | null,
): string {
  return fillOrg(
    PERSON_JOINED_NOTICE[language] ?? PERSON_JOINED_NOTICE.en,
    organisation,
  );
}

const AI_WORDS =
  /(\bai\b|\ba\.i\.|artificial intelligence|\bautomated\b|\bbot\b|chatbot|एआई|स्वचालित|बॉट)/i;
const PEOPLE_WORDS =
  /(\bpeople\b|\bperson\b|\bstaff\b|\bteam\b|\bhumans?\b|\bsomeone\b|लोग|टीम|व्यक्ति|कर्मचारी|\blog\b|\bvyakti\b|\binsaan\b)/i;
const READ_WORDS =
  /(\bread\b|\bsee\b|\breview\b|\bview\b|\bmonitor|पढ़|देख|\bpadh|\bdekh)/i;

/** Whether a notice still says an AI and people may read the chat (keywords, any of en/hi/hi-latn). */
export function noticeKeepsMeaning(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return AI_WORDS.test(t) && PEOPLE_WORDS.test(t) && READ_WORDS.test(t);
}

/**
 * The notice a conversation starts with: the owner's wording when it keeps the meaning, otherwise
 * the fixed notice first, then whatever other wording is set (the platform's default disclaimer).
 */
export function startNotice(options: {
  disclaimer?: string | null;
  language: ReplyLanguage;
  organisation?: string | null;
}): string {
  const own = (options.disclaimer ?? '').trim();
  if (own && noticeKeepsMeaning(own)) return own;
  const fixed = aiNotice(options.language, options.organisation);
  return own ? `${fixed}\n${own}` : fixed;
}

/** TF1 P3: the WhatsApp opt-out sentence, which means nothing on the web page. */
export function withoutStopLine(text: string): string {
  return text
    .replace(/\s*Reply STOP to opt out\.?/gi, '')
    .replace(/\s*STOP (?:लिखें|likhein)[^.।]*[.।]?/gi, '')
    .trim();
}
