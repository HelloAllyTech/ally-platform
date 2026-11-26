import type { ReplyLanguage } from '../engine/reply-language';
import type { CardHeadline } from '../agent-tools/entry-words';

/**
 * Every fixed text BT1 adds (act by tap), in one file for approval: button labels, the lines a tap
 * stands for, the done lines, the WhatsApp fallback. Fixed, never generated. Hindi and Hinglish
 * are drafts for a Hindi speaker to check.
 *
 * The confirmation card's own question is H1's fixed question (`offerFor`), not a new text.
 */

// COPY: needs approval (BT1)
export const BUTTONS: Record<
  ReplyLanguage,
  {
    confirm: string;
    change: string;
    cancel: string;
    move: string;
    keep: string;
    more: string;
  }
> = {
  en: {
    confirm: 'Confirm',
    change: 'Change',
    cancel: 'Cancel',
    move: 'Move',
    keep: 'Keep it',
    more: 'More times',
  },
  hi: {
    confirm: 'पक्का करें',
    change: 'बदलें',
    cancel: 'रद्द करें',
    move: 'समय बदलें',
    keep: 'रहने दें',
    more: 'और समय',
  },
  'hi-latn': {
    confirm: 'Confirm karein',
    change: 'Badlein',
    cancel: 'Cancel karein',
    move: 'Time badlein',
    keep: 'Rehne dein',
    more: 'Aur time',
  },
};

/**
 * What a tap stands for, shown as the person's message and kept in the conversation so the agent
 * sees it next turn. TF1 round 2 (Sahyog N-11): Confirm is kept as the button's own words, as the
 * page showed it when tapped (after a reload it read "Confirmed: Ravi Test"); the done line after
 * it names the entry. `{title}` is the entry's title (its day and time), `{list}` the list's name.
 */
// COPY: needs approval (BT1)
export const TAPPED: Record<
  ReplyLanguage,
  {
    confirmed: string;
    change: string;
    cancel: string;
    move: string;
    keep: string;
  }
> = {
  en: {
    confirmed: 'Confirm',
    change: "I'd like to change it.",
    cancel: 'Please cancel my {list} for {title}.',
    move: "I'd like to move my {list} for {title} to another time.",
    keep: 'Keep it.',
  },
  hi: {
    confirmed: 'पक्का करें',
    change: 'मैं इसे बदलना चाहता/चाहती हूँ।',
    cancel: 'कृपया {title} का मेरा {list} रद्द करें।',
    move: 'मैं {title} का अपना {list} किसी और समय पर करना चाहता/चाहती हूँ।',
    keep: 'रहने दें।',
  },
  'hi-latn': {
    confirmed: 'Confirm karein',
    change: 'Main ise badalna chahta/chahti hoon.',
    cancel: 'Kripya {title} ka mera {list} cancel karein.',
    move: 'Main {title} ka apna {list} kisi aur time par karna chahta/chahti hoon.',
    keep: 'Rehne dein.',
  },
};

/** TF1 round 2 (Saathi B-4): a withdrawn callback request, said as one (never "Done: Asha is cancelled."). */
// COPY: needs approval (TF1 round 2)
export const CALLBACK_CANCELLED_LINE: Record<ReplyLanguage, string> = {
  en: 'Done: your callback request is cancelled.',
  hi: 'हो गया: आपका कॉल बैक का अनुरोध रद्द कर दिया गया है।',
  'hi-latn': 'Ho gaya: aapka callback ka anurodh cancel ho gaya hai.',
};

/**
 * The one line after a write done by tap, by what the list is for (Q4 G5's headlines). `{what}`
 * is the entry's day and time, with its place when it has one ("Sun 29 Nov at 11:00, Bandra West").
 */
// COPY: needs approval (BT1)
export const DONE_LINE: Record<ReplyLanguage, Record<CardHeadline, string>> = {
  en: {
    booked: "Done: you're booked for {what}.",
    registered: "Done: you're registered for {what}.",
    callback: "Done: you've asked for a callback ({what}).",
    application: 'Done: your application is sent ({what}).',
    order: 'Done: your order is placed ({what}).',
    request: 'Done: your request is sent ({what}).',
    sent: 'Done: it has been sent to the team ({what}).',
    saved: 'Done: it is saved ({what}).',
    changed: 'Done: it is changed to {what}.',
    cancelled: 'Done: {what} is cancelled.',
  },
  hi: {
    booked: 'हो गया: {what} के लिए आपकी बुकिंग हो गई है।',
    registered: 'हो गया: {what} के लिए आपका रजिस्ट्रेशन हो गया है।',
    callback: 'हो गया: आपने कॉल बैक माँगा है ({what})।',
    application: 'हो गया: आपका आवेदन भेज दिया गया है ({what})।',
    order: 'हो गया: आपका ऑर्डर हो गया है ({what})।',
    request: 'हो गया: आपका अनुरोध भेज दिया गया है ({what})।',
    sent: 'हो गया: यह टीम को भेज दिया गया है ({what})।',
    saved: 'हो गया: यह सेव हो गया है ({what})।',
    changed: 'हो गया: इसे {what} पर बदल दिया गया है।',
    cancelled: 'हो गया: {what} रद्द कर दिया गया है।',
  },
  'hi-latn': {
    booked: 'Ho gaya: {what} ke liye aapki booking ho gayi hai.',
    registered: 'Ho gaya: {what} ke liye aapka registration ho gaya hai.',
    callback: 'Ho gaya: aapne callback maanga hai ({what}).',
    application: 'Ho gaya: aapki application bhej di gayi hai ({what}).',
    order: 'Ho gaya: aapka order ho gaya hai ({what}).',
    request: 'Ho gaya: aapki request bhej di gayi hai ({what}).',
    sent: 'Ho gaya: yeh team ko bhej diya gaya hai ({what}).',
    saved: 'Ho gaya: yeh save ho gaya hai ({what}).',
    changed: 'Ho gaya: ise {what} par badal diya gaya hai.',
    cancelled: 'Ho gaya: {what} cancel ho gaya hai.',
  },
};

/**
 * TF1 round 2 (Sahyog N-11): what happens next, after the done line of a write the team acts on.
 * Fixed and generic: a list stores no next step of its own, and nothing here is invented ("within
 * 3 working days" is the assistant's to say from the information, never this line's).
 */
// COPY: needs approval (TF1 round 2)
export const NEXT_STEP: Record<
  ReplyLanguage,
  Partial<Record<CardHeadline, string>>
> = {
  en: {
    application: 'The team will be in touch.',
    request: 'The team will be in touch.',
    sent: 'The team will be in touch.',
    callback: 'Someone from the team will call you.',
  },
  hi: {
    application: 'टीम आपसे संपर्क करेगी।',
    request: 'टीम आपसे संपर्क करेगी।',
    sent: 'टीम आपसे संपर्क करेगी।',
    callback: 'टीम से कोई आपको कॉल करेगा।',
  },
  'hi-latn': {
    application: 'Team aapse sampark karegi.',
    request: 'Team aapse sampark karegi.',
    sent: 'Team aapse sampark karegi.',
    callback: 'Team se koi aapko call karega.',
  },
};

/** Fixed replies to a tap that can't go ahead. */
// COPY: needs approval (BT1)
export const TAP_REPLY: Record<
  ReplyLanguage,
  {
    /** The entry was taken between the card and the tap. */
    taken: string;
    /** The button is older than 30 minutes, or its offer was replaced. */
    expired: string;
    /** A button from another chat or person. */
    notYours: string;
    /** A second tap on something already done. */
    already: string;
    /** The write was refused for another reason (a rule), said plainly. */
    refused: string;
    /** Refused, with no reason a person can read (a code or a field key): never shown. */
    refusedPlain: string;
    /** "Keep it" on a cancel card. */
    kept: string;
  }
> = {
  en: {
    taken: 'That time was just taken. Here are other free times:',
    expired:
      'That button has expired. Please type what you would like to do, or ask again.',
    notYours:
      "That button isn't for this chat. Please type what you would like to do.",
    already: 'That is already done.',
    refused: "That couldn't be saved: {reason}",
    refusedPlain:
      "That couldn't be saved. Please type what you would like to do.",
    kept: 'No change: it stays as it is.',
  },
  hi: {
    taken: 'यह समय अभी-अभी भर गया। ये दूसरे खाली समय हैं:',
    expired:
      'यह बटन अब काम नहीं करता। कृपया लिखें कि आप क्या करना चाहते हैं, या फिर से पूछें।',
    notYours:
      'यह बटन इस चैट के लिए नहीं है। कृपया लिखें कि आप क्या करना चाहते हैं।',
    already: 'यह पहले ही हो चुका है।',
    refused: 'यह सेव नहीं हो सका: {reason}',
    refusedPlain: 'यह सेव नहीं हो सका। कृपया लिखें कि आप क्या करना चाहते हैं।',
    kept: 'कोई बदलाव नहीं: यह जैसा है वैसा ही रहेगा।',
  },
  'hi-latn': {
    taken: 'Yeh time abhi-abhi bhar gaya. Yeh doosre khaali time hain:',
    expired:
      'Yeh button ab kaam nahi karta. Kripya likhein ki aap kya karna chahte hain, ya phir se poochhein.',
    notYours:
      'Yeh button is chat ke liye nahi hai. Kripya likhein ki aap kya karna chahte hain.',
    already: 'Yeh pehle hi ho chuka hai.',
    refused: 'Yeh save nahi ho saka: {reason}',
    refusedPlain:
      'Yeh save nahi ho saka. Kripya likhein ki aap kya karna chahte hain.',
    kept: 'Koi badlav nahi: yeh jaisa hai waisa hi rahega.',
  },
};

/** Try it's mark on a card (BT1): nothing a test chat taps is saved. */
// COPY: needs approval (BT1)
export const TEST_ONLY: Record<ReplyLanguage, string> = {
  en: 'Test only, not saved',
  hi: 'सिर्फ़ टेस्ट, सेव नहीं हुआ',
  'hi-latn': 'Sirf test, save nahi hua',
};

/**
 * WhatsApp (BT1 §3): the list message's button and section, and the numbered-text fallback
 * outside the 24-hour window or when an interactive send fails. Meta's limits: a list button and a
 * reply button at most 20 characters, a section title at most 24.
 */
// COPY: needs approval (BT1)
export const WHATSAPP: Record<
  ReplyLanguage,
  { listButton: string; section: string; replyWithNumber: string }
> = {
  en: {
    listButton: 'Choose',
    section: 'Options',
    replyWithNumber: 'Reply with a number:',
  },
  hi: {
    listButton: 'चुनें',
    section: 'विकल्प',
    replyWithNumber: 'नंबर लिखकर जवाब दें:',
  },
  'hi-latn': {
    listButton: 'Chunein',
    section: 'Options',
    replyWithNumber: 'Number likhkar jawab dein:',
  },
};

/**
 * "Reach more communities" (BT1 §0): the language choice at the start, as quick replies. Each
 * label is the language in itself; the tap sends the request in that language.
 */
// COPY: needs approval (BT1)
export const LANGUAGE_CHOICE: { label: string; text: string }[] = [
  { label: 'English', text: 'Please reply in English.' },
  { label: 'हिंदी', text: 'कृपया हिंदी में जवाब दें।' },
  { label: 'Hinglish', text: 'Please Hinglish mein jawab dein.' },
];

export const fillCopy = (
  text: string,
  values: Record<string, string>,
): string =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '').trim();
