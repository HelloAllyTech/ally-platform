/**
 * Scenario fields that support the studio "Enhance" action — a field-level
 * refinement that takes ONLY the field's *existing* content and improves it
 * (auto, or per a custom instruction). Deliberately separate from
 * the removed generate/regenerate feature (auto-generate from scratch): enhance never invents
 * content, it only rewrites what the author already has.
 *
 * To add a new enhanceable field: add an entry here and a label below, then
 * wire the `enhanceType` config + `<EnhanceButton>` on the studio side. The
 * prompt lives in Prompt Management (`enhance_field` / `enhance_state`), so no
 * code change is needed to tweak wording.
 */
export enum EnhanceableField {
  ROLE_INSTRUCTION = 'roleInstruction',
  TITLE = 'title',
  CHARACTER_PROFILE_TEXT = 'characterProfileText',
  DESCRIPTION = 'description',
  OPENING_STATEMENTS = 'openingStatements',
  REMINDERS = 'reminders',
  LINGUISTIC_STYLE_SAMPLES = 'linguisticStyleSamples',
  ALLOWED_FILLER_WORDS = 'allowedFillerWords',
  KNOWLEDGE_SOURCES = 'knowledgeSources',
  /** Structured: improves a simulation state's name AND guidelines together. */
  STATE = 'state',
  /**
   * Structured: the client's details as one JSON object (name, age, gender,
   * gender identity, orientation, profession, location), so a change to who the
   * client is ("make him a girl") changes every detail it implies together.
   */
  CHARACTER_DETAILS = 'characterDetails',
  /**
   * Any other plain-text field, named by the request's `fieldLabel`. A field added to the
   * roleplay form later is improved through this without a change here.
   */
  TEXT = 'text',
  /**
   * Structured: the roleplay's settings (toggles, choices, numbers) as one JSON object, each
   * key a setting and each value of its type. The studio says in `fieldLabel` what each is and
   * which values it takes, and checks the answer against them.
   */
  SETTINGS = 'settings',
}

/**
 * Human-readable description of each field, injected into the enhance prompt
 * so the model knows what it is improving and what good looks like for that
 * field. Keep these phrased as "what this field is".
 */
export const ENHANCEABLE_FIELD_LABELS: Record<EnhanceableField, string> = {
  [EnhanceableField.ROLE_INSTRUCTION]:
    'Role instruction — the directive that tells the AI how to stay in ' +
    'character as the client during the roleplay.',
  [EnhanceableField.TITLE]:
    'Scenario title — a short, learner-facing title for the roleplay. Keep it ' +
    'concise (a few words).',
  [EnhanceableField.CHARACTER_PROFILE_TEXT]:
    'Character backstory — the life history and personality of the AI client ' +
    'persona.',
  [EnhanceableField.DESCRIPTION]:
    'Challenge description — the primary learning goal / situation the ' +
    'counselor is practicing.',
  [EnhanceableField.OPENING_STATEMENTS]:
    'Opening dialogues — the first lines the AI client says to open the ' +
    'session. One dialogue line per text line.',
  [EnhanceableField.REMINDERS]:
    'Reminders — short bullet-point reminders shown to the learner during ' +
    "the live session (not part of the AI client's prompt or scoring). One " +
    'reminder per line.',
  [EnhanceableField.LINGUISTIC_STYLE_SAMPLES]:
    'Linguistic style samples — example sentences showing how the AI client ' +
    'speaks (vocabulary, tone, rhythm). One sample per line. Keep them in the ' +
    'same language as the input.',
  [EnhanceableField.ALLOWED_FILLER_WORDS]:
    'Allowed filler words — short hesitation/filler words or phrases the AI ' +
    'client may use (e.g. "um", "you know"). One per line. Keep them in the ' +
    'same language as the input.',
  [EnhanceableField.KNOWLEDGE_SOURCES]:
    'Knowledge source document — self-contained reference content the AI ' +
    'client can draw on, written in second person ("You ...").',
  [EnhanceableField.STATE]:
    'Simulation state — a short name and the guidelines injected into the prompt ' +
    'while this state is active.',
  [EnhanceableField.CHARACTER_DETAILS]:
    'Character details — one JSON object describing the AI client: "name", "age" (a ' +
    'number), "gender" (male, female or non-binary), "genderIdentity", ' +
    '"sexualOrientation", "profession" and "currentLocation". Return ONE JSON object ' +
    'with the same keys. When the gender changes, change the gender identity to match ' +
    'and give a name that fits the new gender and the same culture, unless the instruction names one.',
  [EnhanceableField.TEXT]:
    'A roleplay field (its name is given with the request).',
  [EnhanceableField.SETTINGS]:
    "Roleplay settings — one JSON object of the roleplay's settings. Return ONE JSON object " +
    'with the same keys, each value of the same type (true/false, a number, or one of the ' +
    'allowed values), changing only the settings the instruction is about.',
};

/**
 * Prompt-Management codes for the enhance prompts (file-backed at
 * src/prompts/enhance_field.txt and src/prompts/enhance_state.txt, editable in
 * the Prompt Management UI). The generic one serves every plain-text field via
 * the {{fieldLabel}} variable; the state one is structured (JSON name+guidelines).
 */
export const ENHANCE_FIELD_PROMPT_CODE = 'enhance_field';
export const ENHANCE_STATE_PROMPT_CODE = 'enhance_state';
