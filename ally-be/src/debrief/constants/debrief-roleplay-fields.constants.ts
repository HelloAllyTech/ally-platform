/**
 * What the Debrief may read about a roleplay (2026-11-18): ONE registry, the single source of truth.
 * The context repository selects exactly these (so a renamed column or metadata key is caught here,
 * and by a spec that checks every entry against the roleplay's own field lists), the runner builds
 * the `session.scenario` block from them, and the release setting `roleplayFields` switches the
 * optional ones on. Always-on fields are never a setting; configuration fields (voices, speech
 * settings, timers, prompts of other agents) are not in the registry at all, so nobody can offer
 * them to a debrief.
 */
export type RoleplayFieldSource =
  | {
      kind: 'column';
      name: 'title' | 'description' | 'difficultyLevel' | 'prompt';
    }
  | {
      kind: 'metadata';
      name: 'characterProfileText' | 'agentBuilderDescription' | 'stateNames';
    };

export interface RoleplayFieldDef {
  /** The key the setting and the console use. */
  key: string;
  /** The key the graph reads in `session.scenario`. */
  out: string;
  label: string;
  /** One plain sentence: what it is and why a debrief might want it. */
  description: string;
  source: RoleplayFieldSource;
  /** Always read; not a setting and never switched off. */
  alwaysOn?: boolean;
  /** On when a release names no `roleplayFields`. */
  defaultOn?: boolean;
  maxChars: number;
}

export const ROLEPLAY_FIELDS: readonly RoleplayFieldDef[] = [
  {
    key: 'title',
    out: 'title',
    label: 'Title',
    description: 'The roleplay’s title.',
    source: { kind: 'column', name: 'title' },
    alwaysOn: true,
    maxChars: 200,
  },
  {
    key: 'description',
    out: 'description',
    label: 'Description',
    description: 'What the roleplay is about, as its author wrote it.',
    source: { kind: 'column', name: 'description' },
    alwaysOn: true,
    maxChars: 2500,
  },
  {
    key: 'difficulty',
    out: 'difficulty_level',
    label: 'Difficulty level',
    description:
      'How hard the author set the roleplay, so the coaching fits the level.',
    source: { kind: 'column', name: 'difficultyLevel' },
    defaultOn: true,
    maxChars: 40,
  },
  {
    key: 'characterProfile',
    out: 'character_profile',
    label: 'Character profile',
    description:
      'Who the client is and what they are going through, as the author described them.',
    source: { kind: 'metadata', name: 'characterProfileText' },
    maxChars: 2500,
  },
  {
    key: 'clientDescription',
    out: 'client_description',
    label: 'Description of the client',
    description:
      'The author’s short description of the client the learner talks to.',
    source: { kind: 'metadata', name: 'agentBuilderDescription' },
    maxChars: 1200,
  },
  {
    key: 'stages',
    out: 'stage_names',
    label: 'Stages of the roleplay',
    description:
      'The names of the stages the conversation moves through, to read progression against.',
    source: { kind: 'metadata', name: 'stateNames' },
    maxChars: 80,
  },
  {
    key: 'clientInstructions',
    out: 'client_instructions',
    label: 'What the client was told to do',
    description:
      'The instructions the client character was given, such as a hidden concern to reveal late.',
    source: { kind: 'column', name: 'prompt' },
    maxChars: 3000,
  },
] as const;

/** The fields a release may switch on or off. */
export const ROLEPLAY_OPTIONAL_KEYS: readonly string[] = ROLEPLAY_FIELDS.filter(
  (f) => !f.alwaysOn,
).map((f) => f.key);

/** The optional fields on when a release names none. */
export const ROLEPLAY_FIELDS_DEFAULT: readonly string[] =
  ROLEPLAY_FIELDS.filter((f) => !f.alwaysOn && f.defaultOn).map((f) => f.key);

/** The release setting that names the optional fields in use. */
export const ROLEPLAY_FIELDS_KEY = 'roleplayFields';
