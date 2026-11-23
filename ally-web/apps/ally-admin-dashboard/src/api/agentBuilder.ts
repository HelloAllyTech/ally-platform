import { ApiEndpoints, HttpMethod } from "@constants";

import { baseAPI } from "./baseApi";

/** The Basic Settings fields Agent Builder Copilot generates in parallel. */
export type AgentBuilderField =
  | "role_instruction"
  | "title"
  | "challenge_description"
  | "knowledge_sources"
  | "persona"
  | "backstory"
  | "states"
  | "opening_statements"
  | "reminders"
  | "linguistic_style_samples"
  | "allowed_filler_words"
  | "spoken_languages"
  | "language_voices";

/** Mirrors the server's EstablishedContextDto. */
export interface AgentBuilderEstablishedContext {
  challengeDescription?: string;
  persona?: Partial<AgentBuilderPersona>;
}

/** A roleplay's mode, from the Course Design Manual (same rules as Course Copilot). */
export type RoleplayMode =
  | "learning"
  | "practice"
  | "performance"
  | "pre_assessment"
  | "post_assessment";

export const ROLEPLAY_MODES: RoleplayMode[] = [
  "learning",
  "practice",
  "performance",
  "pre_assessment",
  "post_assessment",
];

/** What a mode sets on the roleplay form, by form field name. */
export interface RoleplayDesign {
  mode: RoleplayMode;
  settings: {
    experienceMode: "FEEDBACK" | "NONE";
    remindersEnabled: boolean;
    currentState: boolean;
    supervisorNotesEnabled: boolean;
    selectedMainPromptCode?: string;
  };
  /** False when no state-aware main prompt exists: the roleplay gets no states. */
  states: boolean;
}

/** A Character Library character the fit check considered for this roleplay. */
export interface AgentBuilderCharacterSuggestion {
  id: string;
  name: string;
  /** "52, female, farmer, Mandya". */
  summary: string;
  hasVoices: boolean;
  profileExcerpt: string;
}

export interface AgentBuilderCharacterSuggestions {
  /** Search order, best first; only characters this trainer can open. */
  characters: AgentBuilderCharacterSuggestion[];
  /** The fit check's pick; null means none fits (write a new character) or no verdict. */
  recommendedId: string | null;
  reason: string | null;
  /** The library could not be searched: says nothing about what it holds. */
  searchFailed: boolean;
}

export interface GenerateAgentBuilderFieldRequest {
  field: AgentBuilderField;
  actorDescription: string;
  competency?: string;
  agentTestCases?: string;
  numKnowledgeSources?: number;
  /**
   * Language to generate in — only read by the language-scoped fields. A
   * `languages.id` as a string, taken from the `spoken_languages` result.
   */
  languageId?: string;
  /** `language_voices` only: the languages to cast a voice for. */
  languageIds?: string[];
  /** `language_voices` only: the generated persona, so the cast matches it. */
  personaGender?: string;
  personaAge?: number;
  /**
   * The chain's first stage (challenge description + persona), sent with
   * every later field so it builds on the same client. Ignored server-side
   * by the first-stage fields themselves and by `spoken_languages`.
   */
  establishedContext?: AgentBuilderEstablishedContext;
  /**
   * `states` only: the roleplay mode picked in the wizard. The server lays the states out for it
   * (a rupture state below 0, then bands sized for the mode).
   */
  roleplayMode?: RoleplayMode;
  model?: string;
  provider?: "openai" | "anthropic";
}

/**
 * One cast voice from the `language_voices` field. The server has already
 * checked the id belongs to that language's own voices, so it can be written
 * straight into the `languageVoices` mapping.
 */
export interface AgentBuilderVoicePick {
  languageId: string;
  languageLabel: string;
  voiceId: string;
  voiceName: string;
  /** The voice's recorded gender; empty when nobody recorded one. */
  voiceGender: string;
}

/** One language the `spoken_languages` field says the client speaks. */
export interface AgentBuilderSpokenLanguage {
  /** `languages.id` as a string — the key every per-language form field uses. */
  languageId: string;
  label: string;
  /** BCP-47 locale, for display only. */
  code: string;
}

/** Persona demographics returned by the `persona` field generator. */
export interface AgentBuilderPersona {
  name?: string;
  age?: number;
  gender?: string;
  profession?: string;
  currentLocation?: string;
}

export interface AgentBuilderKnowledgeSource {
  title: string;
  content: string;
}

/**
 * One state returned by the `states` field generator. The server has already
 * assigned the stable `id` and the contiguous score bands, so this matches the
 * StatesEditor's SimulationStateFormValue shape and can be dropped straight
 * into the `states` form field.
 */
export interface AgentBuilderState {
  id: string;
  name: string;
  guidelines: string;
  scoreLower: number;
  scoreUpper: number;
  ragEnabled: boolean;
}

/**
 * `value`'s shape depends on `field`:
 *  - role_instruction / title / challenge_description / backstory → string
 *  - opening_statements / reminders → string (newline-joined, one item per line)
 *  - persona → AgentBuilderPersona
 *  - knowledge_sources → AgentBuilderKnowledgeSource[]
 *  - states → AgentBuilderState[]
 *  - linguistic_style_samples / allowed_filler_words → string[], written in
 *    the requested `languageId`
 *  - spoken_languages → AgentBuilderSpokenLanguage[]
 *  - language_voices → AgentBuilderVoicePick[]
 */
export interface GenerateAgentBuilderFieldResponse {
  field: AgentBuilderField;
  value: unknown;
}

const agentBuilderAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /**
     * Agent Builder Copilot: generate ONE Basic Settings field from the wizard's
     * actor brief + competency + agent test cases. The wizard fires one of
     * these per target field concurrently — and, for the language-scoped
     * fields, once per language the client speaks; each returned trigger
     * exposes `.abort()` so the whole batch can be cancelled.
     */
    generateAgentBuilderField: builder.mutation<
      GenerateAgentBuilderFieldResponse,
      GenerateAgentBuilderFieldRequest
    >({
      query: body => ({
        url: ApiEndpoints.SIMULATION_STUDIO.GENERATE_AGENT_BUILDER_FIELD,
        method: HttpMethod.POST,
        body,
      }),
    }),

    /** Library characters that could play the roleplay, with the fit check's recommendation. */
    suggestAgentBuilderCharacters: builder.mutation<
      AgentBuilderCharacterSuggestions,
      { description: string; competencyIds?: string[]; mode?: RoleplayMode }
    >({
      query: body => ({
        url: ApiEndpoints.SIMULATION_STUDIO.AGENT_BUILDER_CHARACTER_SUGGESTIONS,
        method: HttpMethod.POST,
        body,
      }),
    }),

    /** Which fields a trainer's change request touches, and what to change in each. */
    revisePlan: builder.mutation<
      { fields: { id: string; change: string }[]; reply: string },
      { instruction: string; fields: { id: string; label: string; value: string }[] }
    >({
      query: body => ({
        url: ApiEndpoints.SIMULATION_STUDIO.AGENT_BUILDER_REVISE_PLAN,
        method: HttpMethod.POST,
        body,
      }),
    }),

    /** What a roleplay mode sets: supports, experience mode and the state-aware main prompt. */
    getRoleplayDesign: builder.query<RoleplayDesign, RoleplayMode>({
      query: mode => ({
        url: ApiEndpoints.SIMULATION_STUDIO.AGENT_BUILDER_ROLEPLAY_DESIGN,
        method: HttpMethod.GET,
        params: { mode },
      }),
    }),
  }),
});

export const {
  useGenerateAgentBuilderFieldMutation,
  useLazyGetRoleplayDesignQuery,
  useSuggestAgentBuilderCharactersMutation,
  useRevisePlanMutation,
} = agentBuilderAPI;
