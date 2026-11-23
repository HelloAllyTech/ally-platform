import type { ReplyLanguage } from '../engine/reply-language';

/**
 * The fixed words for erase in chat (R5): the confirm question, the result, and the owner's
 * notice. English, Hindi and Hindi in Latin script only, like every fixed safety text. Never
 * generated. The owner notice carries no message content.
 */

export type ErasedPart = 'conversations' | 'memory' | 'contact_details';
export type KeptPart =
  | 'flagged_conversations'
  | 'list_records'
  | 'sign_in'
  | 'backups';

// COPY: needs approval
export const ERASE_CONFIRM_COPY: Record<ReplyLanguage, string> = {
  en: 'Do you want me to erase your conversations, what I remember about you and your contact details? Reply YES to confirm. You will still be able to sign in.',
  hi: 'क्या आप चाहते हैं कि मैं आपकी बातचीत, आपके बारे में याद रखी बातें और आपके संपर्क विवरण मिटा दूँ? पुष्टि के लिए हाँ लिखें। आप फिर भी साइन इन कर सकेंगे।',
  'hi-latn':
    'Kya aap chahte hain ki main aapki baatcheet, aapke baare mein yaad rakhi baatein aur aapke contact details mita doon? Confirm karne ke liye HAAN likhein. Aap phir bhi sign in kar sakenge.',
};

// COPY: needs approval
export const ERASE_CANCELLED_COPY: Record<ReplyLanguage, string> = {
  en: 'Nothing was erased.',
  hi: 'कुछ भी नहीं मिटाया गया।',
  'hi-latn': 'Kuch bhi nahin mitaya gaya.',
};

// COPY: needs approval
const ERASED_LINES: Record<ReplyLanguage, Record<ErasedPart, string>> = {
  en: {
    conversations: 'your conversations',
    memory: 'what I remembered about you',
    contact_details: 'your name and contact details',
  },
  hi: {
    conversations: 'आपकी बातचीत',
    memory: 'आपके बारे में याद रखी बातें',
    contact_details: 'आपका नाम और संपर्क विवरण',
  },
  'hi-latn': {
    conversations: 'aapki baatcheet',
    memory: 'aapke baare mein yaad rakhi baatein',
    contact_details: 'aapka naam aur contact details',
  },
};

// COPY: needs approval
const KEPT_LINES: Record<ReplyLanguage, Record<KeptPart, string>> = {
  en: {
    flagged_conversations:
      'A conversation where you may have needed urgent help is kept for up to 12 months for your safety, then erased.',
    list_records:
      'Records you made with this service (such as bookings or requests) are kept, because they belong to the organisation. Ask them if you want these removed.',
    sign_in:
      'Your phone number or email stays on the access list so you can still sign in.',
    backups: 'Backups are not edited; they are deleted on their own schedule.',
  },
  hi: {
    flagged_conversations:
      'जिस बातचीत में आपको तुरंत मदद की ज़रूरत हो सकती थी, वह आपकी सुरक्षा के लिए 12 महीने तक रखी जाती है, फिर मिटा दी जाती है।',
    list_records:
      'इस सेवा के साथ बनाए गए रिकॉर्ड (जैसे बुकिंग या अनुरोध) रखे जाते हैं, क्योंकि वे संस्था के हैं। इन्हें हटवाने के लिए उनसे पूछें।',
    sign_in:
      'आपका फ़ोन नंबर या ईमेल एक्सेस सूची में रहता है ताकि आप फिर भी साइन इन कर सकें।',
    backups: 'बैकअप नहीं बदले जाते; वे अपने समय पर मिटाए जाते हैं।',
  },
  'hi-latn': {
    flagged_conversations:
      'Jis baatcheet mein aapko turant madad ki zaroorat ho sakti thi, woh aapki suraksha ke liye 12 mahine tak rakhi jaati hai, phir mita di jaati hai.',
    list_records:
      'Is seva ke saath banaye gaye records (jaise booking ya request) rakhe jaate hain, kyunki woh sanstha ke hain. Inhe hatwane ke liye unse poochhein.',
    sign_in:
      'Aapka phone number ya email access list mein rehta hai taaki aap phir bhi sign in kar sakein.',
    backups: 'Backups nahin badle jaate; woh apne samay par mitaye jaate hain.',
  },
};

// COPY: needs approval
const DONE_HEAD: Record<ReplyLanguage, string> = {
  en: 'Done. I have erased {list}.',
  hi: 'हो गया। मैंने {list} मिटा दी हैं।',
  'hi-latn': 'Ho gaya. Maine {list} mita di hain.',
};

const AND: Record<ReplyLanguage, string> = {
  en: ' and ',
  hi: ' और ',
  'hi-latn': ' aur ',
};

function joinList(items: string[], language: ReplyLanguage): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}${AND[language]}${items[items.length - 1]}`;
}

/** What the customer is told after an erase: what went, then each thing kept and why. */
export function eraseResultMessage(
  language: ReplyLanguage,
  result: { erased: ErasedPart[]; kept: { what: KeptPart }[] },
): string {
  const lines = [
    DONE_HEAD[language].replace(
      '{list}',
      joinList(
        result.erased.map((p) => ERASED_LINES[language][p]),
        language,
      ),
    ),
    ...result.kept.map((k) => KEPT_LINES[language][k.what]),
  ];
  return lines.join('\n');
}

/** The reason a kept item is kept, in English, for the structured result and the owner notice. */
export function keptWhy(what: KeptPart): string {
  return KEPT_LINES.en[what];
}

// COPY: needs approval
/** The owner's notice: no message content, no contact details. */
export const ERASE_OWNER_NOTICE = {
  subject: 'A person erased their data on {assistant}',
  body:
    'A person asked {assistant} to erase their data on {date}. Their conversations, memory and contact details were erased. ' +
    '{kept} Nothing else is needed from you. If they also want their list records removed, they will contact you.',
  keptFlagged:
    'A conversation flagged for safety is kept until its 12-month keep ends.',
} as const;
