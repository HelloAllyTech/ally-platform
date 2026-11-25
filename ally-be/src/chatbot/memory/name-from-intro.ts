/**
 * A name the person stated outright (TF1 round 2, Saathi B-2): "my name is Asha", "mera naam
 * Asha hai", "मेरा नाम आशा है". Only those: never "call me…" ("Can someone call me back tomorrow
 * evening?") and never a bare "I'm…" ("I'm stressed", "I'm 16", "I'm scared"); those are left to
 * the model's own `remember` name op, which reads the whole conversation.
 */
const WORD = String.raw`[\p{L}\p{M}]{2,20}`;
const NAME = String.raw`(${WORD}(?:\s+${WORD})?)`;

const PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`\bmy name is\s+${NAME}(?=\s*(?:[.,!?]|$|\s+and\b))`,
    'iu',
  ),
  new RegExp(String.raw`\bmera naam\s+${NAME}\s+(?:hai|h)\b`, 'iu'),
  new RegExp(String.raw`मेरा नाम\s+${NAME}\s+है`, 'u'),
];

/** Words that follow "my name is" without being a name ("my name is not important"). */
const NOT_A_NAME = new Set([
  'not',
  'none',
  'secret',
  'private',
  'unknown',
  'nothing',
  'anonymous',
  'important',
  'kya',
  'kuch',
  'nahi',
  'mat',
]);

/**
 * A message that is only a greeting and an introduction ("Hi, I'm Asha", "hello, I am Asha Rao"):
 * the same whole-message rule ally-ai uses to skip the search (`agent_runtime/greeting.py`). Never
 * "I'm X" inside a longer message, and never a state, a feeling or an age ("I'm stressed",
 * "I'm 16", "I'm scared").
 */
const GREETING_INTRO = new RegExp(
  String.raw`^\s*(?:(?:hi+|hey+|hello+|hiya|namaste|namaskar|good (?:morning|afternoon|evening))(?:\s+(?:ji|there|team))?[\s,.!-]*)?(?:i'?m|i am|im)\s+${NAME}[\s.!]*$`,
  'iu',
);
const NOT_A_NAME_AFTER_IM = new Set(
  `a an the so very really just not also still feeling fine good ok okay well sad scared stressed
  anxious worried tired afraid alone lonely lost confused upset depressed angry sorry sick ill
  unwell hurt pregnant new back here there home busy free done ready sure happy glad bored hungry
  broke stuck trapped dying nervous overwhelmed exhausted panicking crying struggling unsafe safe
  late early interested homeless suicidal desperate drunk high numb empty useless hopeless
  helpless worthless urgent serious alive dead better worse great awful terrible bad`.split(
    /\s+/,
  ),
);
const DESCRIBING = /(?:ing|ed|less|ful|ous|ive|ish)$/;

export function nameFromIntro(text: string | null | undefined): string | null {
  const said = (text ?? '').trim();
  if (!said || said.length > 300) return null;
  const intro = said.length <= 80 ? GREETING_INTRO.exec(said) : null;
  if (intro) {
    const words = intro[1].trim().split(/\s+/);
    const describes = words.some(
      (w) =>
        NOT_A_NAME_AFTER_IM.has(w.toLowerCase()) ||
        DESCRIBING.test(w.toLowerCase()),
    );
    if (!describes) {
      return words
        .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ');
    }
  }
  for (const pattern of PATTERNS) {
    const match = pattern.exec(said);
    if (!match) continue;
    const words = match[1].trim().split(/\s+/);
    if (words.some((w) => NOT_A_NAME.has(w.toLowerCase()))) return null;
    return words
      .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  }
  return null;
}
