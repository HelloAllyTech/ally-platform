import { isHealthPack } from '../../bot-draft/safety-pack/safety-packs';

/**
 * Never store (chunk 8a): what an assistant must never remember about a person. Every bot has the
 * platform's defaults, a health pack adds its own, and the owner can add lines. The defaults can't
 * be removed: safety only tightens.
 *
 * The prompt tells the agent the whole list; this is the check in code that a line passes before
 * it's stored. The defaults are matched by pattern; an owner's line by its words. On health packs
 * the clinical words here are only a backstop: the model check (`ally_ai_memory_check`) is the
 * gate, and it fails closed.
 */

/** The defaults every bot has, as the owner and the agent read them. */
export const NEVER_STORE_EVERY_BOT = [
  'Payment details',
  'Passwords and PINs',
  'ID numbers',
] as const;

/** What a health, pharmacy or mental-health pack adds. */
export const NEVER_STORE_HEALTH = [
  'Symptoms',
  'Conditions',
  'Medicines',
  'Diagnoses',
] as const;

export const MAX_OWNER_NEVER_STORE = 20;
export const MAX_NEVER_STORE_CHARS = 80;

const EVERY_BOT_PATTERNS: RegExp[] = [
  // Card and account numbers, and the words for them.
  /\b(?:\d[ -]?){12,19}\b/,
  /\b(?:card number|credit card|debit card|cvv|cvc|iban|ifsc|account number|bank account|upi)\b/i,
  // Passwords, PINs and one-time codes.
  /\b(?:password|passcode|passwd|pin|otp|one[- ]time code)\b/i,
  // ID numbers: Aadhaar, PAN, US SSN, passport, and the words for them.
  /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/,
  /\b[A-Z]{5}\d{4}[A-Z]\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:aadhaar|aadhar|pan card|passport|ssn|social security|driving licen[cs]e|national id)\b/i,
];

const HEALTH_PATTERNS: RegExp[] = [
  /\b(?:symptom|diagnos|disorder|syndrome|disease|illness|condition)\w*/i,
  /\b(?:medicine|medication|meds|tablet|pill|capsule|dose|dosage|prescri|antidepress|ssri|\d+\s?mg)\w*/i,
  /\b(?:sertraline|fluoxetine|escitalopram|citalopram|paroxetine|venlafaxine|duloxetine|bupropion|mirtazapine|lithium|quetiapine|olanzapine|risperidone|aripiprazole|clonazepam|alprazolam|lorazepam|diazepam|zolpidem|metformin|insulin)\b/i,
  /\b(?:depress|anxiety|panic attack|bipolar|adhd|ptsd|ocd|schizo|psychos|eating disorder|anorexi|bulimi|insomnia|diabet|cancer|hiv|asthma|epilep|migraine|hypertension)\w*/i,
  /\b(?:suicid|self[- ]?harm|cutting|overdos|kill (?:my|him|her)self|end (?:my|it all))\w*/i,
];

const STOP = new Set([
  'about',
  'and',
  'any',
  'for',
  'from',
  'into',
  'of',
  'or',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'with',
  'what',
]);

/** The words of an owner's line that carry its meaning, lower-case. */
const wordsOf = (line: string): string[] =>
  (line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length >= 3 && !STOP.has(w),
  );

/** The list the owner sees and the agent is told: the defaults, then the owner's own lines. */
export function neverStoreList(
  safetyPack: string | null | undefined,
  owner: readonly string[] | undefined,
): string[] {
  const defaults: string[] = [
    ...NEVER_STORE_EVERY_BOT,
    ...(isHealthPack(safetyPack) ? NEVER_STORE_HEALTH : []),
  ];
  const seen = new Set(defaults.map((d) => d.toLowerCase()));
  const own = (owner ?? []).filter((line) => {
    const key = line.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...defaults, ...own];
}

/** The owner's lines, cleaned for saving: trimmed, no blanks, no repeats, no defaults. */
export function cleanOwnerNeverStore(
  safetyPack: string | null | undefined,
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Things never to remember must be a list.');
  }
  const defaults = new Set(
    neverStoreList(safetyPack, []).map((d) => d.toLowerCase()),
  );
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new Error('Each thing never to remember must be text.');
    }
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (line.length > MAX_NEVER_STORE_CHARS) {
      throw new Error(
        `Each one can be at most ${MAX_NEVER_STORE_CHARS} characters.`,
      );
    }
    const key = line.toLowerCase();
    if (defaults.has(key) || out.some((o) => o.toLowerCase() === key)) {
      continue;
    }
    out.push(line);
  }
  if (out.length > MAX_OWNER_NEVER_STORE) {
    throw new Error(`Up to ${MAX_OWNER_NEVER_STORE} of your own.`);
  }
  return out;
}

/**
 * Whether a line may not be stored: it matches a default's pattern, the health backstop on a
 * health pack, or every meaningful word of one of the owner's lines (as the start of a word, so
 * "religion" also catches "religious").
 */
export function matchesNeverStore(
  text: string,
  safetyPack: string | null | undefined,
  owner: readonly string[] | undefined,
): boolean {
  if (EVERY_BOT_PATTERNS.some((p) => p.test(text))) return true;
  if (isHealthPack(safetyPack) && HEALTH_PATTERNS.some((p) => p.test(text))) {
    return true;
  }
  const words = wordsOf(text);
  return (owner ?? []).some((line) => {
    const needed = wordsOf(line);
    return (
      needed.length > 0 &&
      needed.every((n) =>
        words.some((w) => w.startsWith(n.slice(0, Math.max(4, n.length - 2)))),
      )
    );
  });
}
