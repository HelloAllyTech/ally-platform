/**
 * The character interview's stages, in code (Course Pilot phase 5C, CHARACTER_PILOT_STAGES): the
 * same design as the roleplay interview's (roleplay-pilot-stages.util.ts). The interview order
 * lived only in the prompt and nothing was recorded until the final save, so it could not be
 * checked: the baseline eval asked 0 or 21-24 questions, repeated a topic in 4 of 6 runs, and
 * left a language without its voice in 2 of 6.
 *
 * What is settled is recorded as the interview goes (`record_character` →
 * `session.metadata.characterBrief`). The stage is DERIVED from that record — the first stage
 * whose exit check fails — and each stage has a question limit. save_character_draft exists only
 * at the end, and the draft must carry every recorded language with a voice. Questions are
 * tagged with their stage and counted from the transcript, so no state is stored for counts.
 */

export type CharacterPilotStageId =
  | 'kind'
  | 'identity'
  | 'life'
  | 'voice'
  | 'draft';

/** What the interview has settled about the character so far. */
export interface CharacterPilotBrief {
  /** Who they are and what they are going through, in a sentence or two. */
  kind?: string;
  name?: string;
  age?: number;
  gender?: string;
  genderIdentity?: string;
  sexualOrientation?: string;
  profession?: string;
  currentLocation?: string;
  personality?: string;
  /** Numeric language ids (as strings), from get_voices. */
  languageIds?: string[];
  /** languageId → voiceId. */
  voices?: Record<string, string>;
  /** Recorded languages the voice catalogue has no voice for: they need none (set by code). */
  unvoicedLanguageIds?: string[];
  /** The admin asked the agent to decide the rest itself (set by code from their words). */
  decideRest?: boolean;
}

export interface CharacterPilotStage {
  id: CharacterPilotStageId;
  title: string;
  goal: string;
  /** Questions allowed in this stage (0 at the draft: everything is recorded, write it). */
  questions: number;
  canSave: boolean;
}

/** The whole interview's question limit. */
export const CHARACTER_PILOT_MAX_QUESTIONS = 10;

export const CHARACTER_PILOT_STAGES: readonly CharacterPilotStage[] = [
  {
    id: 'kind',
    title: 'Kind of character',
    goal:
      'Who this person is and what they are going through, in a sentence or two, and what ' +
      'roleplays they are for. Record it as `kind`.',
    questions: 2,
    canSave: false,
  },
  {
    id: 'identity',
    title: 'Identity',
    goal:
      'Name, age and gender (exactly male / female / non-binary). Gender identity and sexual ' +
      'orientation default to what fits unless the admin says otherwise. Ask several on one ' +
      'card when you can, or propose them and let the admin change them.',
    questions: 3,
    canSave: false,
  },
  {
    id: 'life',
    title: 'Their life',
    goal:
      'Profession (or what they do), where they live now, and a line on personality. Infer what ' +
      'the kind of character already implies.',
    questions: 3,
    canSave: false,
  },
  {
    id: 'voice',
    title: 'Languages and voices',
    goal:
      'The languages they speak and one voice per language. Call get_voices first; record ' +
      'languageIds and voices (languageId → voiceId) with record_character. English unless ' +
      'the admin named others: record only languages they named or picked; to add one, ask ' +
      'with a languages card. Pick the voice yourself, and say which, when the admin asked you ' +
      'to decide or one voice clearly fits; ask only when the choice is really theirs.',
    questions: 3,
    canSave: false,
  },
  {
    id: 'draft',
    title: 'The draft',
    goal:
      'Everything needed is recorded: write the full profile with save_character_draft, using ' +
      'exactly what is recorded (same name, age, gender, languages and voices).',
    questions: 0,
    canSave: true,
  },
];

const BY_ID = new Map(CHARACTER_PILOT_STAGES.map((stage) => [stage.id, stage]));

export function characterPilotStage(
  id: CharacterPilotStageId,
): CharacterPilotStage {
  return BY_ID.get(id)!;
}

export function isCharacterPilotStageId(
  value: unknown,
): value is CharacterPilotStageId {
  return typeof value === 'string' && BY_ID.has(value as CharacterPilotStageId);
}

const filled = (text: unknown) =>
  typeof text === 'string' && text.trim().length > 0;

function missingFor(
  id: CharacterPilotStageId,
  brief: CharacterPilotBrief,
): string[] {
  const missing: string[] = [];
  switch (id) {
    case 'kind':
      if (!filled(brief.kind)) missing.push('what kind of character this is');
      break;
    case 'identity':
      if (!filled(brief.name)) missing.push('a name');
      if (typeof brief.age !== 'number') missing.push('the age');
      if (!filled(brief.gender)) missing.push('the gender');
      break;
    case 'life':
      if (!filled(brief.profession)) missing.push('the profession');
      if (!filled(brief.currentLocation)) missing.push('where they live');
      break;
    case 'voice': {
      const languages = brief.languageIds ?? [];
      if (!languages.length) missing.push('the languages they speak');
      const unvoiced = new Set(brief.unvoicedLanguageIds ?? []);
      const withoutVoice = languages.filter(
        (id) => !unvoiced.has(id) && !brief.voices?.[id],
      );
      if (withoutVoice.length) {
        missing.push(`a voice for language ${withoutVoice.join(', ')}`);
      }
      break;
    }
    default:
      break;
  }
  return missing;
}

export interface CharacterPilotPosition {
  stage: CharacterPilotStage;
  step: number;
  steps: number;
  missing: string[];
  askedHere: number;
  totalAsked: number;
  questionsLeft: number;
}

export function resolveCharacterPilotStage(
  brief: CharacterPilotBrief | null | undefined,
  asked: Partial<Record<CharacterPilotStageId, number>>,
): CharacterPilotPosition {
  const b = brief ?? {};
  let stage = characterPilotStage('draft');
  let missing: string[] = [];
  for (const id of ['kind', 'identity', 'life', 'voice'] as const) {
    const gaps = missingFor(id, b);
    if (gaps.length) {
      stage = characterPilotStage(id);
      missing = gaps;
      break;
    }
  }
  const askedHere = asked[stage.id] ?? 0;
  const totalAsked = Object.values(asked).reduce((n, v) => n + (v ?? 0), 0);
  return {
    stage,
    step: CHARACTER_PILOT_STAGES.indexOf(stage) + 1,
    steps: CHARACTER_PILOT_STAGES.length,
    missing,
    askedHere,
    totalAsked,
    questionsLeft: Math.max(
      0,
      Math.min(
        stage.questions - askedHere,
        CHARACTER_PILOT_MAX_QUESTIONS - totalAsked,
      ),
    ),
  };
}

export function countCharacterStageQuestions(
  messages: { metadata?: Record<string, any> | null }[],
): Partial<Record<CharacterPilotStageId, number>> {
  const out: Partial<Record<CharacterPilotStageId, number>> = {};
  for (const message of messages) {
    for (const question of message.metadata?.questions ?? []) {
      const stage: unknown = question?.stage;
      if (isCharacterPilotStageId(stage)) out[stage] = (out[stage] ?? 0) + 1;
    }
  }
  return out;
}

/** The admin's words handing the rest to the agent ("you decide", "use your defaults"). */
const DECIDE_REST =
  /\b(you decide|your (call|choice)|up to you|use (your )?defaults?|(decide|choose|fill in|pick) (the rest|anything else|everything else|everything|it) (yourself|for me)?|decide (yourself|for me)|don['’]?t ask( me)?( much| more)?|no more questions|just (build|make|create) (it|the character))\b/i;

export function handsRestToAgent(text: string | null | undefined): boolean {
  return DECIDE_REST.test(String(text ?? ''));
}

export function characterQuestionRefusal(
  position: CharacterPilotPosition,
  brief: CharacterPilotBrief = {},
): string | null {
  if (brief.decideRest) {
    return (
      'No questions: the admin asked you to decide the rest yourself. Decide what is still ' +
      `missing (${position.missing.join('; ') || 'nothing'}) consistently with what they said, ` +
      'record it with record_character, and carry on to the draft; name your choices in the ' +
      'reply so they can change them afterwards.'
    );
  }
  if (position.questionsLeft > 0) return null;
  const where =
    position.totalAsked >= CHARACTER_PILOT_MAX_QUESTIONS
      ? `the interview's ${CHARACTER_PILOT_MAX_QUESTIONS}-question limit`
      : `the ${position.stage.questions}-question limit for "${position.stage.title}"`;
  return (
    `No more questions: you have reached ${where}. Decide what is still missing ` +
    `(${position.missing.join('; ') || 'nothing'}) consistently with what the admin said, ` +
    'record it with record_character, and say in your reply what you chose so the admin can ' +
    'change it. Your reply must not ask anything: a question without a card cannot be answered.'
  );
}

export function characterSaveRefusal(
  position: CharacterPilotPosition,
): string | null {
  if (position.stage.canSave) return null;
  return (
    `Not saved: the interview is at "${position.stage.title}", which still needs ` +
    `${position.missing.join('; ')}. Record those with record_character first (decide them ` +
    'yourself if the admin asked you to, and say what you chose).'
  );
}

/** Problems with a draft against the record: languages and voices must match it. */
export function draftAgainstBrief(
  draft: { voices?: unknown; languageCharacteristics?: unknown },
  brief: CharacterPilotBrief,
): string[] {
  const languages = brief.languageIds ?? [];
  if (!languages.length) return [];
  const voices =
    draft.voices && typeof draft.voices === 'object'
      ? (draft.voices as Record<string, unknown>)
      : {};
  const characteristics =
    draft.languageCharacteristics &&
    typeof draft.languageCharacteristics === 'object'
      ? (draft.languageCharacteristics as Record<string, unknown>)
      : {};
  const problems: string[] = [];
  const recorded = new Set(languages);
  const extra = [
    ...new Set([...Object.keys(voices), ...Object.keys(characteristics)]),
  ].filter((id) => !recorded.has(id));
  if (extra.length) {
    problems.push(
      `language ${extra.join(', ')} is not recorded: use only the recorded languages ` +
        `(${languages.join(', ')}) in voices and languageCharacteristics`,
    );
  }
  const unvoiced = new Set(brief.unvoicedLanguageIds ?? []);
  for (const id of languages) {
    if (!voices[id] && !unvoiced.has(id)) {
      problems.push(
        `voices must include language ${id} (recorded voice ${brief.voices?.[id] ?? 'none'})`,
      );
    }
    if (!characteristics[id]) {
      problems.push(`languageCharacteristics must include language ${id}`);
    }
  }
  return problems;
}

export function renderCharacterPilotStage(
  position: CharacterPilotPosition,
  brief: CharacterPilotBrief,
): string {
  const { stage, step, steps, missing, questionsLeft } = position;
  return [
    `<character_stage id="${stage.id}" step="${step} of ${steps}" questions_left="${questionsLeft}">`,
    `Recorded so far: ${JSON.stringify(brief)}`,
    `Stage: ${stage.title}. ${stage.goal}`,
    missing.length
      ? `Still needed before the next stage: ${missing.join('; ')}.`
      : '',
    stage.canSave
      ? ''
      : 'save_character_draft is not available yet: it opens once kind, identity, life, languages and voices are recorded.',
    brief.decideRest
      ? 'The admin asked you to decide the rest: ask nothing; record every remaining field yourself now and write the draft.'
      : '',
    'Work only on this stage; it moves on by itself once these are recorded. Record what the ' +
      'admin already told you with record_character before asking anything (several fields at ' +
      'once is fine), and never ask what is already recorded. If the admin gave everything up ' +
      'front, or asked you to decide, record it all now and move straight on.',
    '</character_stage>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** "Hindi (India)" → "hindi": the language's name as an admin would type it. */
const baseLanguageName = (label: string) =>
  label
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .toLowerCase();

/**
 * The recorded languages the admin never named, to drop. The agent added Hindi or a regional
 * language for Indian characters unasked (languages right in 3 of 6 eval runs). A language counts
 * as named when its name is in the admin's words — typed, or picked on a card (a pick arrives as
 * their message). With none named, one language (the default) is allowed. One variant per
 * language: "English" does not make English (India) and English (US) two languages.
 */
export function languagesNotNamed(
  languageIds: string[],
  labels: Map<string, string>,
  adminWords: string,
): string[] {
  const words = adminWords.toLowerCase();
  const named = (id: string) => {
    const base = baseLanguageName(labels.get(id) ?? '');
    return base.length > 0 && new RegExp(`\\b${base}\\b`).test(words);
  };
  const anyNamed = languageIds.some(named);
  // None named: the one default is English when it is among them, else the first.
  const fallback =
    languageIds.find(
      (id) => baseLanguageName(labels.get(id) ?? '') === 'english',
    ) ?? languageIds[0];
  const seen = new Set<string>();
  const dropped: string[] = [];
  languageIds.forEach((id) => {
    const base = baseLanguageName(labels.get(id) ?? id);
    const allowed = anyNamed ? named(id) : id === fallback;
    if (!allowed || seen.has(base)) dropped.push(id);
    else seen.add(base);
  });
  return dropped;
}
