/**
 * A person stepping in (chunk 11a): the pure parts. When a visitor is asking for a person, what
 * they're told, and the owner's settings. No I/O here; `HandoverService` does that.
 */

/**
 * Why a chat needs a person: they asked, the assistant said "I don't know" twice in a row, or the
 * assistant passed it on with its `hand_over` tool (chunk 3b). The database's check constraint
 * lists the same values.
 */
export const NEEDS_PERSON_REASONS = [
  'asked',
  'declined_twice',
  'assistant',
] as const;
export type NeedsPersonReason = (typeof NEEDS_PERSON_REASONS)[number];

/** Opening hours, in the business's time zone. Days are 0 (Sunday) to 6. */
export interface OpeningHours {
  timeZone: string;
  days: number[];
  /** "09:00" */
  from: string;
  /** "18:00" */
  to: string;
}

export interface HandoverSettings {
  /** "They usually reply within {hours}": the owner's words, e.g. "a few hours", "an hour". */
  replyWithin: string;
  /** Without hours, the visitor is always told the in-hours message. */
  hours: OpeningHours | null;
  /** A held chat goes back to the assistant after this long with no reply from the team. */
  autoHandBackHours: number;
  /** The owners are emailed when a chat has needed a person this long with no one opening it. */
  emailAfterMinutes: number;
  /** The visitor sees "{first name} from {business}" (on) or "{business}" (off). */
  showFirstName: boolean;
}

export const HANDOVER_DEFAULTS: HandoverSettings = {
  replyWithin: 'a few hours',
  hours: null,
  autoHandBackHours: 12,
  emailAfterMinutes: 15,
  showFirstName: true,
};

export const HANDOVER_LIMITS = {
  replyWithinChars: 40,
  autoHandBackHours: { min: 1, max: 72 },
  emailAfterMinutes: { min: 5, max: 240 },
};

/** A bot's hand-over settings, with the defaults for anything it hasn't set. */
export function handoverOf(settings: {
  handover?: Partial<HandoverSettings>;
}): HandoverSettings {
  return { ...HANDOVER_DEFAULTS, ...(settings.handover ?? {}) };
}

/** What the visitor and the team are told (copy §23, chunk 11a). */
export const HANDOVER_COPY = {
  inHours: "I've asked the team to join. They usually reply within {hours}.",
  outOfHours:
    "The team is away now. They'll reply when they're back at {time}.",
  autoHandBack:
    "The team couldn't reply this time, so I'm back to help. You can ask for a person again any time.",
  from: '{first name} from {business}',
  emailSubject: 'A conversation needs you',
  emailBody:
    'Someone talking to {assistant} would like a person. Nobody has opened the conversation yet. Open it: {link}',
  whatsappWindowClosed:
    'WhatsApp only lets you reply within 24 hours of their last message. You can reply again when they next write.',
} as const;

export function fill(
  text: string,
  values: Record<string, string | number>,
): string {
  return text.replace(/\{([\w ]+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

// "talk to a person", "speak with someone", "real human", "an agent", "customer care"…
const ENGLISH =
  /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+|an\s+|some\s*one|a\s+real\s+)?(?:person|human|someone|somebody|agent|staff|representative|real\s+person|member\s+of\s+(?:your\s+)?(?:team|staff))\b|\b(?:real|actual|live)\s+(?:person|human|agent)\b|\b(?:connect|transfer|put)\s+me\s+(?:to|through\s+to|with)\s+(?:a\s+|an\s+)?(?:person|human|someone|agent|staff)\b|\bhuman\s+(?:agent|being|please)\b|\b(?:i\s+(?:want|need)\s+(?:a\s+|to\s+talk\s+to\s+a\s+)?)(?:human|person)\b/i;
// Hinglish: "insaan se baat", "kisi se baat karni hai", "kisi aadmi se baat", "agent se baat"
const HINGLISH =
  /\b(?:insaan|insan|kisi|aadmi|admi|agent|staff|banda|bande)\s+(?:se|say)\s+baat\b|\bbaat\s+(?:karni|karna|karwa|karao)\b.*\b(?:insaan|kisi|aadmi|agent)\b/i;
// Hindi: "इंसान से बात", "किसी से बात", "व्यक्ति से बात", "एजेंट से बात"
const HINDI = /(?:इंसान|इन्सान|किसी|व्यक्ति|आदमी|एजेंट|स्टाफ)\s*से\s*बात/;

/**
 * Whether a message asks for a person, in English, Hindi or Hinglish. Checked after crisis: a
 * crisis message gets the crisis reply, never a hand-over.
 */
export function asksForPerson(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 300) return false;
  return ENGLISH.test(t) || HINGLISH.test(t) || HINDI.test(t);
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** The local weekday and minutes of an instant in a time zone. */
function localNow(
  now: Date,
  timeZone: string,
): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    get('weekday'),
  );
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function clock(hhmm: string): string {
  const total = minutesOf(hhmm);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m
    ? `${h12}:${String(m).padStart(2, '0')} ${suffix}`
    : `${h12} ${suffix}`;
}

/**
 * Whether the team is in now, and if not, when they're back ("9 am tomorrow", "9 am on Monday").
 * Without hours set, always in.
 */
export function openNow(
  hours: OpeningHours | null,
  now: Date,
):
  | { open: true }
  | {
      open: false;
      back: string;
      /** The parts of `back`, for other languages (Q4 G1): "9 am", 0 today, 1 tomorrow… */
      clock: string;
      ahead: number;
      weekday: number;
    } {
  if (!hours || !hours.days.length) return { open: true };
  const { day, minutes } = localNow(now, hours.timeZone);
  const from = minutesOf(hours.from);
  const to = minutesOf(hours.to);
  if (hours.days.includes(day) && minutes >= from && minutes < to) {
    return { open: true };
  }
  for (let ahead = 0; ahead < 8; ahead += 1) {
    const d = (day + ahead) % 7;
    if (!hours.days.includes(d)) continue;
    if (ahead === 0 && minutes >= from) continue;
    const when =
      ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : `on ${WEEKDAYS[d]}`;
    return {
      open: false,
      back: `${clock(hours.from)} ${when}`,
      clock: clock(hours.from),
      ahead,
      weekday: d,
    };
  }
  return { open: true };
}

/** The languages the hand-over lines are written in (Q4 G1): English, Hindi, Hinglish. */
export type HandoverLanguage = 'en' | 'hi' | 'hi-latn';

/**
 * The hand-over lines in Hindi and Hinglish (Q4 G1, Round 7: "I've asked the team to join" went
 * out in English to Hindi, Tamil and Bengali messages). Fixed text, like the crisis replies; the
 * owner's "reply within" words are translated when they're one of the usual ones, and left out
 * otherwise rather than put mid-sentence in English.
 */
export const HANDOVER_COPY_IN: Record<
  Exclude<HandoverLanguage, 'en'>,
  {
    inHours: string;
    inHoursSoon: string;
    outOfHours: string;
    autoHandBack: string;
    within: Record<string, string>;
    today: string;
    tomorrow: string;
    onDay: string;
    weekdays: string[];
  }
> = {
  hi: {
    inHours:
      'मैंने टीम से इस बातचीत में जुड़ने के लिए कह दिया है। वे आमतौर पर {hours} में जवाब देते हैं।',
    inHoursSoon:
      'मैंने टीम से इस बातचीत में जुड़ने के लिए कह दिया है। वे जल्द ही जवाब देंगे।',
    outOfHours: 'टीम अभी उपलब्ध नहीं है। वे {time} वापस आकर जवाब देंगे।',
    autoHandBack:
      'टीम इस बार जवाब नहीं दे पाई, इसलिए मैं फिर से आपकी मदद के लिए यहाँ हूँ। आप कभी भी किसी व्यक्ति से बात करने के लिए कह सकते हैं।',
    within: {
      'a few hours': 'कुछ घंटों',
      'an hour': 'एक घंटे',
      '1 hour': 'एक घंटे',
      'a day': 'एक दिन',
      '24 hours': '24 घंटों',
      '30 minutes': '30 मिनट',
    },
    today: 'आज {clock}',
    tomorrow: 'कल {clock}',
    onDay: '{day} को {clock}',
    weekdays: [
      'रविवार',
      'सोमवार',
      'मंगलवार',
      'बुधवार',
      'गुरुवार',
      'शुक्रवार',
      'शनिवार',
    ],
  },
  'hi-latn': {
    inHours:
      'Maine team ko is chat mein judne ke liye keh diya hai. Woh aam taur par {hours} mein reply karte hain.',
    inHoursSoon:
      'Maine team ko is chat mein judne ke liye keh diya hai. Woh jald hi reply karenge.',
    outOfHours:
      'Team abhi available nahi hai. Woh {time} wapas aakar reply karenge.',
    autoHandBack:
      'Team is baar reply nahi kar payi, isliye main phir se aapki madad ke liye yahan hoon. Aap kabhi bhi kisi person se baat karne ke liye keh sakte hain.',
    within: {
      'a few hours': 'kuch ghanton',
      'an hour': 'ek ghante',
      '1 hour': 'ek ghante',
      'a day': 'ek din',
      '24 hours': '24 ghanton',
      '30 minutes': '30 minute',
    },
    today: 'aaj {clock}',
    tomorrow: 'kal {clock}',
    onDay: '{day} ko {clock}',
    weekdays: [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ],
  },
};

/** The one message a visitor gets when a person is asked to join, in their language (Q4 G1). */
export function handoverMessage(
  settings: HandoverSettings,
  now: Date,
  language: HandoverLanguage = 'en',
): string {
  const state = openNow(settings.hours, now);
  if (language === 'en') {
    return state.open
      ? fill(HANDOVER_COPY.inHours, { hours: settings.replyWithin })
      : fill(HANDOVER_COPY.outOfHours, { time: state.back });
  }
  const copy = HANDOVER_COPY_IN[language];
  if (state.open) {
    const hours = copy.within[settings.replyWithin.trim().toLowerCase()];
    return hours ? fill(copy.inHours, { hours }) : copy.inHoursSoon;
  }
  const when =
    state.ahead === 0
      ? copy.today
      : state.ahead === 1
        ? copy.tomorrow
        : copy.onDay;
  const time = fill(when, {
    clock: state.clock,
    day: copy.weekdays[state.weekday],
  });
  return fill(copy.outOfHours, { time });
}

/** A stored message language ("hi", "hi-Latn", "en", "ta"…) as a hand-over line's language. */
export function handoverLanguageOf(
  language: string | null | undefined,
): HandoverLanguage {
  const value = String(language ?? '').toLowerCase();
  if (value.startsWith('hi') && value.includes('latn')) return 'hi-latn';
  if (value === 'hinglish') return 'hi-latn';
  if (value.startsWith('hi')) return 'hi';
  return 'en';
}

/** "The team couldn't reply this time…" in the conversation's language (Q4 G1). */
export function autoHandBackMessage(language: HandoverLanguage = 'en'): string {
  return language === 'en'
    ? HANDOVER_COPY.autoHandBack
    : HANDOVER_COPY_IN[language].autoHandBack;
}

/** How a team member's reply is signed to the visitor. */
export function senderLabel(
  name: string | null | undefined,
  business: string,
  showFirstName: boolean,
): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return showFirstName && first
    ? fill(HANDOVER_COPY.from, { 'first name': first, business })
    : business;
}

/** WhatsApp's customer-service window: a free-form reply within 24 hours of their last message. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function whatsappWindowOpen(
  lastInboundAt: Date | null,
  now: Date,
): boolean {
  return (
    !!lastInboundAt &&
    now.getTime() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS
  );
}
