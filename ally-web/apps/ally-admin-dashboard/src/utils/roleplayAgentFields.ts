/**
 * How the roleplay agent treats every field of the roleplay form — one place, so a field added
 * to the form is adapted by the agent the moment it is listed here, and cannot be forgotten:
 * `roleplayAgentFields.test.ts` fails for any form field that is not.
 *
 * - `text`: the agent rewrites it when a request is about it (and when the client changes).
 *   `enhanceAs` names the backend's own prompt for it; without one, the field is improved as
 *   generic text described by `label`.
 * - `perLanguage`: a map of language id → text (or lines); each language is rewritten on its own.
 * - `items`: a list of {id, title, content}; each item's content is rewritten on its own.
 * - `translation`: another language's copy of a `text` field; re-translated when that changes.
 * - `states`, `character`, `voices`: their own steps (states as name + guidelines; the client's
 *   details as one object; voices swapped to the client's gender).
 * - `setting`: a toggle, choice or number the agent may change on request ("make it hard").
 * - `trainer`: only the trainer changes it, on the form (say why).
 * - `app`: kept by the app itself (say why).
 *
 * `library: true` marks what a Character Library character is made from.
 */

export type RoleplayAgentField =
  | { kind: "text"; label: string; enhanceAs?: string; library?: boolean }
  | {
      kind: "perLanguage";
      label: string;
      shape: "text" | "lines";
      enhanceAs?: string;
      library?: boolean;
    }
  | { kind: "items"; label: string; enhanceAs?: string; library?: boolean }
  | { kind: "translation"; of: string; shape: "text" | "lines" }
  | { kind: "states" }
  | { kind: "character"; library: true }
  | { kind: "voices"; library: true }
  | {
      kind: "setting";
      label: string;
      type: "boolean" | "number" | "choice" | "duration";
      options?: readonly string[];
      /** A duration's range, as the form's HH:MM:SS. */
      min?: string;
      max?: string;
    }
  | { kind: "trainer"; reason: string; library?: boolean }
  | { kind: "app"; reason: string };

/** The choices' values, as the form offers them (the test holds them to the form's lists). */
export const SETTING_CHOICES = {
  difficultyLevel: ["EASY", "MEDIUM", "HARD"],
  experienceMode: ["FEEDBACK", "CHECKLIST", "NONE"],
  checklistType: ["GUIDED", "UNGUIDED", "LIST"],
} as const;

const toggle = (label: string): RoleplayAgentField => ({ kind: "setting", label, type: "boolean" });

export const ROLEPLAY_AGENT_FIELDS: Record<string, RoleplayAgentField> = {
  // ── Text the agent writes and rewrites ──
  prompt: { kind: "text", label: "Role instruction", enhanceAs: "roleInstruction" },
  title: { kind: "text", label: "Title", enhanceAs: "title" },
  description: { kind: "text", label: "Challenge description", enhanceAs: "description" },
  characterProfileText: {
    kind: "text",
    label: "Character backstory",
    enhanceAs: "characterProfileText",
    library: true,
  },
  openingStatements: { kind: "text", label: "Opening lines", enhanceAs: "openingStatements" },
  reminders: { kind: "text", label: "Reminders", enhanceAs: "reminders" },
  context: {
    kind: "text",
    label: "Context — the background the client brings to the conversation",
  },
  helperAgentPrompt: {
    kind: "text",
    label: "Helper agent instruction — how the in-session helper supports the learner",
  },
  linguisticStyleSamples: {
    kind: "perLanguage",
    label: "Linguistic style samples — example sentences in the client's voice, one per line",
    shape: "lines",
    enhanceAs: "linguisticStyleSamples",
    library: true,
  },
  allowedFillerWords: {
    kind: "perLanguage",
    label: "Allowed filler words",
    shape: "lines",
    enhanceAs: "allowedFillerWords",
  },
  languageCharacteristics: {
    kind: "perLanguage",
    label: "How the client speaks this language — accent, register, code-mixing",
    shape: "text",
    library: true,
  },
  knowledgeSources: {
    kind: "items",
    label: "Knowledge source",
    enhanceAs: "knowledgeSources",
    library: true,
  },
  memories: {
    kind: "items",
    label: "Memory — something the client remembers and may bring up",
  },

  // ── Other languages' copies, kept in step with their source ──
  translationTitle: { kind: "translation", of: "title", shape: "text" },
  translationDescription: { kind: "translation", of: "description", shape: "text" },
  translationOpeningStatements: { kind: "translation", of: "openingStatements", shape: "lines" },
  translationReminders: { kind: "translation", of: "reminders", shape: "text" },

  // ── Their own steps ──
  states: { kind: "states" },
  name: { kind: "character", library: true },
  age: { kind: "character", library: true },
  gender: { kind: "character", library: true },
  genderIdentity: { kind: "character", library: true },
  sexualOrientation: { kind: "character", library: true },
  profession: { kind: "character", library: true },
  currentLocation: { kind: "character", library: true },
  languageVoices: { kind: "voices", library: true },

  // ── Settings the agent may change on request ──
  difficultyLevel: {
    kind: "setting",
    label: "How hard the client is",
    type: "choice",
    options: SETTING_CHOICES.difficultyLevel,
  },
  experienceMode: {
    kind: "setting",
    label: "What the learner sees after the session: feedback, a checklist or nothing",
    type: "choice",
    options: SETTING_CHOICES.experienceMode,
  },
  checklistType: {
    kind: "setting",
    label: "Checklist kind, in checklist mode",
    type: "choice",
    options: SETTING_CHOICES.checklistType,
  },
  summaryChecklistEnabled: toggle("Show the checklist on the learner's summary"),
  timerMode: toggle("Time limit on the session"),
  // The form keeps it as text, HH:MM:SS, in its own range.
  maxTimeValue: {
    kind: "setting",
    label: "Session time limit",
    type: "duration",
    min: "00:05:00",
    max: "02:00:00",
  },
  showScoreMeter: toggle("Show the score meter during the session"),
  feedbackTabDebrief: toggle("Debrief tab after the session"),
  feedbackTabTranscript: toggle("Transcript tab after the session"),
  remindersEnabled: toggle("Show reminders during the session"),
  supervisorNotesEnabled: toggle("Supervisor notes"),
  liveTabEnabled: toggle("Live tab during the session"),
  pauseEnabled: toggle("Learner can pause the session"),
  textChatEnabled: toggle("Learner can type instead of speaking"),
  fillerEnabled: toggle("Client uses filler words"),
  languageGlossaryEnabled: toggle("Language glossary"),
  comfortAudioEnabled: toggle("Comfort audio while the client thinks"),
  currentState: toggle("Show the client's current state to the learner"),

  // ── Only the trainer, on the form ──
  isGlobal: { kind: "trainer", reason: "who can see the roleplay is a publishing decision" },
  isPublic: { kind: "trainer", reason: "who can see the roleplay is a publishing decision" },
  triggerWarningIds: { kind: "trainer", reason: "set from the interview; a safety label" },
  optGuardrails: { kind: "trainer", reason: "safety guardrails stay the trainer's decision" },
  debriefRiskCueOption: { kind: "trainer", reason: "a safety setting for risk cues" },
  category: { kind: "trainer", reason: "catalogue placement" },
  partnerOrgName: { kind: "trainer", reason: "catalogue placement" },
  coverImageUrl: { kind: "trainer", reason: "media, made by the cover job", library: true },
  coverVideoUrl: { kind: "trainer", reason: "media, uploaded", library: true },
  comfortAudioUrl: { kind: "trainer", reason: "media, uploaded" },
  comfortAudioVolume: { kind: "trainer", reason: "audio level, set by ear" },
  videoActorEnabled: { kind: "trainer", reason: "video actor needs an avatar set up" },
  videoActorAvatarId: { kind: "trainer", reason: "video actor needs an avatar set up" },
  videoActorProvider: { kind: "trainer", reason: "video actor needs an avatar set up" },
  historyTrimEnabled: { kind: "trainer", reason: "a latency setting" },
  continuousBackchanneling: { kind: "trainer", reason: "a latency setting" },
  interimReplyEnabled: { kind: "trainer", reason: "a latency setting" },
  temperature: { kind: "trainer", reason: "a model setting" },
  sttConfigByLanguage: { kind: "trainer", reason: "speech recognition, set per language" },
  fhsBenchmark: { kind: "trainer", reason: "platform benchmark flag" },
  customFields: { kind: "trainer", reason: "trainer-defined name/value pairs" },
  stateInstructions: { kind: "trainer", reason: "older structured instructions" },
  behaviorInstructions: { kind: "trainer", reason: "older structured instructions" },
  terminationEvents: { kind: "trainer", reason: "when the session ends is a scoring decision" },
  autoTerminationStatus: {
    kind: "trainer",
    reason: "when the session ends is a scoring decision",
  },
  agentDialogues: { kind: "trainer", reason: "older dialogue list" },
  competency: { kind: "trainer", reason: "set from the interview; changes what is scored" },
  competencies: { kind: "trainer", reason: "set from the interview; changes what is scored" },
  agentTestCaseIds: { kind: "trainer", reason: "set from the interview; steers scoring" },
  selectedMainPromptCode: { kind: "trainer", reason: "which prompt version runs" },
  selectedEvaluatorPromptCode: { kind: "trainer", reason: "which prompt version scores" },
  mainPromptVariantByLanguage: { kind: "trainer", reason: "which prompt version runs" },

  // ── Kept by the app ──
  openingDialoguePrimaryLanguageId: { kind: "app", reason: "which language the source text is" },
  challengeDescriptionPrimaryLanguageId: {
    kind: "app",
    reason: "which language the source text is",
  },
  remindersPrimaryLanguageId: { kind: "app", reason: "which language the source text is" },
  stateNames: { kind: "app", reason: "derived from the states" },
  characterProfileSelector: { kind: "app", reason: "the picker's own value" },
  agentBuilderDescription: { kind: "app", reason: "the agent's own record of the brief" },
  agentBuilderChat: { kind: "app", reason: "the agent's own conversation" },
  agentBuilderPrompt: { kind: "app", reason: "the agent's own record" },
};

/** The fields of one kind, with their form ids. */
export const fieldsOfKind = <K extends RoleplayAgentField["kind"]>(kind: K) =>
  Object.entries(ROLEPLAY_AGENT_FIELDS).filter(
    (entry): entry is [string, Extract<RoleplayAgentField, { kind: K }>] => entry[1].kind === kind,
  );

/** The form fields a Character Library character is made from. */
export const LIBRARY_CHARACTER_FIELDS = Object.entries(ROLEPLAY_AGENT_FIELDS)
  .filter(([, field]) => "library" in field && field.library)
  .map(([id]) => id);
