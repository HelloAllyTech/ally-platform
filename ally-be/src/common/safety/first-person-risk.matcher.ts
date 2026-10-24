/**
 * The first layer of the Ally guide's safety net (plans/ally-guide/plan.md
 * §6.2): a synchronous, high-precision match for a person saying, in the
 * first person and now, that they intend to end their life or harm
 * themselves. A hit short-circuits the turn to the FIXED crisis response.
 *
 * Why first-person and not topical — the difference from the WhatsApp bot's
 * crisis rules. Ally's users are counsellors in training. "Suicide", "self
 * harm", "she wants to die" are the subject matter of their courses, said
 * every day in professional discussion and quoted from roleplay personas. A
 * topical match would put them in crisis mode for doing their job, and a
 * safety net that cries wolf is one people learn to route around. So this
 * layer only fires on the speaker's own present-tense statements, and steps
 * aside for reported speech ("my client said 'I want to die'"); the
 * context-aware classifier (layer 2) catches what a phrase list cannot,
 * including indirect disclosure.
 *
 * Normalisation keeps Unicode marks (\p{M}): Devanagari, Tamil and Kannada
 * vowel signs are marks, and stripping them turns every phrase below into a
 * different word.
 *
 * THE PHRASE LISTS ARE A DRAFT pending the clinical safety reviewer's and
 * native speakers' sign-off (plan §13.1, open question Q1). Adding a phrase
 * is cheap; a phrase that fires on professional talk is not — add a negative
 * example to the spec with every positive.
 */

export type RiskLanguage = 'en' | 'hi' | 'mr' | 'ta' | 'kn';

export interface FirstPersonRiskMatch {
  language: RiskLanguage;
  /** The normalised phrase that matched, for the trace and calibration. */
  phrase: string;
}

/** Lower-case, NFKC, punctuation to spaces (marks kept), spaces collapsed. */
export function normaliseForRisk(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// English: subject forms and contractions are expanded by the builder below,
// so each line is written once in its plainest form.
const EN_I_STATEMENTS = [
  'want to die',
  'wanna die',
  'want to kill myself',
  'am going to kill myself',
  'am gonna kill myself',
  'will kill myself',
  'am thinking of killing myself',
  'am thinking about killing myself',
  'have been thinking about killing myself',
  'want to end my life',
  'am going to end my life',
  'want to end it all',
  'am going to end it all',
  'want to take my own life',
  'do not want to live',
  'do not want to be alive',
  'do not want to wake up',
  'am better off dead',
  'should just die',
  'want to hurt myself',
  'am going to hurt myself',
  'have been hurting myself',
  'have been cutting myself',
  'have a plan to kill myself',
  'have taken an overdose',
  'took an overdose',
  'have taken too many pills',
  'took too many pills',
];

/** Statements that need no "I" in front of them. */
const EN_STANDALONE = [
  'kill myself',
  'no reason to live',
  'nothing to live for',
  'everyone would be better off without me',
  'going to end it tonight',
];

function englishPhrases(): string[] {
  const out = new Set<string>(EN_STANDALONE);
  for (const statement of EN_I_STATEMENTS) {
    out.add(`i ${statement}`);
    // "i am going" → "i'm going" / "im going"; "i have been" → "i've been"; …
    if (statement.startsWith('am ')) {
      const rest = statement.slice(3);
      out.add(`i'm ${rest}`);
      out.add(`im ${rest}`);
    }
    if (statement.startsWith('have ')) {
      const rest = statement.slice(5);
      out.add(`i've ${rest}`);
      out.add(`ive ${rest}`);
    }
    if (statement.startsWith('will ')) {
      out.add(`i'll ${statement.slice(5)}`);
    }
    if (statement.startsWith('do not ')) {
      const rest = statement.slice(7);
      out.add(`i don't ${rest}`);
      out.add(`i dont ${rest}`);
    }
  }
  return [...out];
}

const PHRASES: Record<RiskLanguage, string[]> = {
  en: englishPhrases(),
  hi: [
    // Devanagari
    'मैं मरना चाहता हूँ',
    'मैं मरना चाहती हूँ',
    'मैं मरना चाहता हूं',
    'मैं मरना चाहती हूं',
    'मुझे मर जाना है',
    'मैं खुद को मार डालूँगा',
    'मैं खुद को मार डालूँगी',
    'मैं खुद को मारना चाहता',
    'मैं खुद को मारना चाहती',
    'मैं आत्महत्या करना चाहता',
    'मैं आत्महत्या करना चाहती',
    'मैं आत्महत्या कर लूँगा',
    'मैं आत्महत्या कर लूँगी',
    'मैं जीना नहीं चाहता',
    'मैं जीना नहीं चाहती',
    'मैं अपनी जान ले लूँगा',
    'मैं अपनी जान ले लूँगी',
    // Hinglish (romanised)
    'main marna chahta hu',
    'main marna chahta hoon',
    'main marna chahti hu',
    'main marna chahti hoon',
    'mai marna chahta hu',
    'mai marna chahti hu',
    'mujhe mar jana hai',
    'mujhe marna hai',
    'main khud ko maar dunga',
    'main khud ko maar dungi',
    'main suicide karna chahta',
    'main suicide karna chahti',
    'main suicide kar lunga',
    'main suicide kar lungi',
    'main jeena nahi chahta',
    'main jeena nahi chahti',
    'mujhe jeena nahi hai',
  ],
  mr: [
    'मला मरायचं आहे',
    'मला मरायचे आहे',
    'मी आत्महत्या करणार',
    'मी स्वतःला मारून टाकणार',
    'मला जगायचं नाही',
    'मला जगायचे नाही',
  ],
  ta: [
    'நான் சாக வேண்டும்',
    'நான் சாகப் போகிறேன்',
    'நான் தற்கொலை செய்து கொள்ளப் போகிறேன்',
    'நான் தற்கொலை செய்ய விரும்புகிறேன்',
    'எனக்கு வாழ விருப்பமில்லை',
  ],
  kn: [
    'ನಾನು ಸಾಯಬೇಕು',
    'ನಾನು ಸಾಯುತ್ತೇನೆ',
    'ನಾನು ಆತ್ಮಹತ್ಯೆ ಮಾಡಿಕೊಳ್ಳುತ್ತೇನೆ',
    'ನನಗೆ ಬದುಕಲು ಇಷ್ಟವಿಲ್ಲ',
  ],
};

/**
 * Words that mark the phrase as someone else's speech when they come before
 * it in the same clause: "my client said I want to die", "the persona says
 * …", "मरीज ने कहा …". Deliberately short. "like" and "say" are left out:
 * "I feel like I want to die" and "I can't say it, but I want to die" are the
 * learner's own words, and this layer is the floor when the classifier fails.
 */
const REPORTED_SPEECH = [
  'said',
  'says',
  'told me',
  'tells me',
  'told us',
  'wrote',
  'writes',
  'asked',
  'asks',
  'quoted',
  'mentioned',
  'mentions',
  'replied',
  'responded',
  'ने कहा',
  'कहा कि',
  'बोला',
  'बोली',
  'bola',
  'boli',
  'kaha',
  'म्हणाला',
  'म्हणाली',
  'சொன்னார்',
  'ಹೇಳಿದರು',
];

/** How far back, in words, a reported-speech marker still governs a phrase. */
const REPORTED_SPEECH_WINDOW = 6;

const COMPILED = (Object.keys(PHRASES) as RiskLanguage[]).flatMap((language) =>
  PHRASES[language].map((phrase) => ({
    language,
    phrase: normaliseForRisk(phrase),
  })),
);

const REPORTED = REPORTED_SPEECH.map(normaliseForRisk);

function wordBoundaryIndex(text: string, phrase: string): number {
  let from = 0;
  for (;;) {
    const index = text.indexOf(phrase, from);
    if (index < 0) return -1;
    const before = index === 0 ? ' ' : text[index - 1];
    const afterIndex = index + phrase.length;
    const after = afterIndex >= text.length ? ' ' : text[afterIndex];
    if (before === ' ' && after === ' ') return index;
    from = index + 1;
  }
}

function isReportedSpeech(text: string, index: number): boolean {
  const before = text.slice(0, index).split(' ').filter(Boolean);
  const window = ` ${before.slice(-REPORTED_SPEECH_WINDOW).join(' ')} `;
  return REPORTED.some((marker) => window.includes(` ${marker} `));
}

/** The learner's own present-tense risk statement, or null. */
export function matchFirstPersonRisk(
  text: string,
): FirstPersonRiskMatch | null {
  const normalised = normaliseForRisk(text);
  if (!normalised) return null;
  for (const { language, phrase } of COMPILED) {
    const index = wordBoundaryIndex(normalised, phrase);
    if (index >= 0 && !isReportedSpeech(normalised, index)) {
      return { language, phrase };
    }
  }
  return null;
}
