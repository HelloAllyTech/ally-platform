/**
 * The /v2 homepage conversation: what a visitor can ask Ally, how typed text is
 * routed, and the scripted practice moment. Pure data and functions — the page
 * owns the state and renders what these return.
 *
 * Every answer is reviewed copy from the `homeV2` i18n namespace, never generated
 * text. This is a public, signed-out page on a mental-health platform, so nothing
 * a visitor reads here is improvised, and nothing here calls a model.
 */

export type Topic =
  | "practice"
  | "again"
  | "what"
  | "access"
  | "org"
  | "privacy"
  | "news"
  | "languages"
  | "cost"
  | "support"
  | "signin"
  | "fallback";

export type PracticeChoice = "a" | "b" | "c";
export const PRACTICE_CHOICES: readonly PracticeChoice[] = ["a", "b", "c"];

export type Card = "products" | "org" | "privacy" | "news" | "support";

/** Where an Ally line links to. Resolved to a URL by the page, so this module stays dependency-free. */
export type LinkTarget = "partner" | "team" | "learn";

export type Entry =
  | {
      kind: "ally";
      /** Key under `homeV2.answers`. */
      key: string;
      /** i18n interpolation; a numeric `count` selects the plural form. */
      values?: Record<string, string | number>;
      tone?: "quiet" | "error";
      link?: { key: string; target: LinkTarget };
    }
  /** `key` re-translates when the language changes; `text` is what the visitor typed, shown as typed. */
  | { kind: "user"; key?: string; text?: string }
  | { kind: "client"; key: string }
  | { kind: "choices"; answered: boolean }
  | { kind: "feedback"; choice: PracticeChoice }
  | { kind: "card"; card: Card };

export type ConversationContext = Topic | "practiced" | null;

const ally = (key: string, extra: Partial<Extract<Entry, { kind: "ally" }>> = {}): Entry => ({
  kind: "ally",
  key,
  ...extra,
});

const card = (which: Card): Entry => ({ kind: "card", card: which });

const practiceSetup = (introKey: string): Entry[] => [
  ally(introKey),
  { kind: "client", key: "homeV2.practice.opening" },
  { kind: "choices", answered: false },
];

/** What Ally says for a topic. The visitor's own line is added by the caller. */
export const respond = (topic: Topic): Entry[] => {
  switch (topic) {
    case "practice":
      return practiceSetup("practiceSetup");
    case "again":
      return practiceSetup("practiceAgain");
    case "what":
      return [ally("whatIntro"), card("products"), ally("whatMore", { tone: "quiet" })];
    case "access":
      return [
        ally("access1"),
        ally("access2", { link: { key: "homeV2.links.partner", target: "partner" } }),
      ];
    case "org":
      return [ally("org"), card("org")];
    case "privacy":
      return [ally("privacy"), card("privacy")];
    case "news":
      return [ally("news"), card("news")];
    case "languages":
      return [ally("languages1"), ally("languages2", { tone: "quiet" })];
    case "cost":
      return [ally("cost", { link: { key: "homeV2.links.partner", target: "partner" } })];
    case "support":
      return [ally("support"), card("support"), ally("supportAfter", { tone: "quiet" })];
    case "signin":
      return [ally("signin")];
    case "fallback":
    default:
      return [
        ally("fallback"),
        ally("fallbackMore", {
          tone: "quiet",
          link: { key: "homeV2.links.writeTeam", target: "team" },
        }),
      ];
  }
};

/** What follows the visitor picking one of Riya's three replies. */
export const practiceOutcome = (choice: PracticeChoice): Entry[] => [
  { kind: "user", key: `homeV2.practice.choices.${choice}` },
  { kind: "client", key: `homeV2.practice.reactions.${choice}` },
  { kind: "feedback", choice },
  ally("practiceWrap"),
];

const BASE_SUGGESTIONS: readonly Topic[] = [
  "practice",
  "what",
  "access",
  "org",
  "privacy",
  "news",
  "support",
];

/**
 * The suggestion chips to show next: the ones not yet asked, and straight after a
 * practice moment the three natural next steps first.
 */
export const suggestionsFor = (asked: readonly Topic[], context: ConversationContext): Topic[] => {
  let topics = BASE_SUGGESTIONS.filter(topic => !asked.includes(topic));
  if (context === "practiced") {
    topics = ["again", "access", "signin", ...topics.filter(topic => topic !== "access")];
  }
  return topics.slice(0, 7);
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Phrases that mean the visitor may be in distress themselves. A match always
 * routes to the fixed support answer, and the text is never logged. Erring
 * towards false positives is deliberate: a support number shown to someone who
 * didn't need it costs little, a missed one costs a great deal.
 */
const DISTRESS_EN =
  /\b(suicid\w*|kill(ing)? my ?self|end(ing)? my life|end it all|want(ed)? to die|wanna die|don'?t want to (live|be alive)|hurt(ing)? my ?self|self[- ]?harm\w*|cutting my ?self|i('?m| am) not ok(ay)?|not ok(ay)? these days|can'?t cope|can'?t go on|hopeless|panic attacks?|i need (some )?(help|support)|feel(ing)? (so |really |very )?(low|alone|lonely|depressed|empty|worthless))\b/i;

/** The same, in the app's other languages and in romanised Hindi. Needs native review. */
const DISTRESS_PHRASES = [
  // Hindi
  "आत्महत्या",
  "मरना चाहत",
  "जीना नहीं चाहत",
  "ठीक नहीं हूँ",
  "ठीक नहीं हूं",
  "खुद को नुकसान",
  // Marathi
  "मरायचं आहे",
  "मरायचे आहे",
  "जगायचं नाही",
  "जगायचे नाही",
  // Tamil
  "தற்கொலை",
  "சாக வேண்டும்",
  "வாழ விருப்பமில்லை",
  // Kannada
  "ಆತ್ಮಹತ್ಯೆ",
  "ಸಾಯಬೇಕು",
  "ಬದುಕಲು ಇಷ್ಟವಿಲ್ಲ",
  // Romanised Hindi
  "aatmahatya",
  "atmahatya",
  "marna chahta",
  "marna chahti",
  "jeena nahi",
  "theek nahi hoon",
  "thik nahi hu",
];

export const isDistress = (raw: string): boolean => {
  const text = raw.normalize("NFC").toLowerCase();
  return DISTRESS_EN.test(text) || DISTRESS_PHRASES.some(phrase => text.includes(phrase));
};

/** First match wins, so the order matters: a question about cost for an NGO is about cost. */
const TOPIC_RULES: ReadonlyArray<[Topic, RegExp]> = [
  [
    "privacy",
    /privac|private|confidential|\bmy data\b|\bdata\b|secure|security|recording|recorded|गोपनीय|डेटा|தனியுரிமை|ಗೋಪ್ಯತೆ/i,
  ],
  [
    "languages",
    /language|hindi|tamil|marathi|kannada|telugu|bengali|bangla|malayalam|gujarati|punjabi|odia|oriya|भाषा|भाषे|மொழி|ಭಾಷೆ/i,
  ],
  ["cost", /\bfree\b|\bcosts?\b|\bprice|pricing|\bpay\b|\bfees?\b|मुफ़्त|मुफ्त|मोफत|இலவச|ಉಚಿತ/i],
  ["signin", /sign ?in|log ?in|\blogin\b|लॉग ?इन|साइन ?इन/i],
  [
    "org",
    /organi[sz]ation|\bngos?\b|my team|\btrainers?\b|training|\bschools?\b|partner|\bhelplines?\b|supervis|संस्था/i,
  ],
  ["access", /access|\bjoin\b|sign ?up|register|create (an )?account|invite|get started/i],
  ["news", /what'?s new|\bnews\b|\bblog\b|changelog|\bupdates?\b|roadmap|latest/i],
  [
    "practice",
    /\btry\b|practi[cs]e|\bdemo\b|role ?play|simulat|sample|अभ्यास|सराव|பயிற்சி|ಅಭ್ಯಾಸ/i,
  ],
  [
    "what",
    /what is|what'?s ally|\babout\b|who (are|is)|how does|\bproducts?\b|\bscribe\b|\bassist\b|क्या है|काय आहे|என்ன|ಏನು/i,
  ],
];

export const topicFor = (raw: string): Topic | null => {
  const text = raw.normalize("NFC");
  const rule = TOPIC_RULES.find(([, pattern]) => pattern.test(text));
  return rule ? rule[0] : null;
};

export type Routed =
  | { type: "email"; email: string }
  | { type: "distress" }
  | { type: "topic"; topic: Topic; matched: boolean };

/** Routes what a visitor typed: an email starts sign-in, distress gets support, anything else a topic. */
export const routeTyped = (raw: string): Routed => {
  const text = raw.trim();
  if (EMAIL.test(text)) return { type: "email", email: text.toLowerCase() };
  if (isDistress(text)) return { type: "distress" };
  // Match on the scrubbed text, so an address like `@ngo.org` can't pass for a question about NGOs.
  const topic = topicFor(scrubQuestion(text));
  return topic
    ? { type: "topic", topic, matched: true }
    : { type: "topic", topic: "fallback", matched: false };
};

/**
 * An unmatched question, made fit to log: emails, phone-like numbers and links
 * are replaced and the text is capped. Names and case details cannot be scrubbed
 * reliably, which is why only unmatched questions are logged at all, and never a
 * message that matched distress.
 */
export const scrubQuestion = (raw: string): string =>
  raw
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** `priya@ngo.org` → `p••••@ngo.org`, for showing a remembered address on a possibly shared screen. */
export const maskEmail = (email: string): string => {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return `${email.slice(0, 1)}••••${email.slice(at)}`;
};
