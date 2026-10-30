/**
 * Catalog of placeholders the ai-learn prompt builder can substitute into
 * a main-agent prompt. This is the *available* universe — the contract
 * enforced by `_build_behavior_prompt` in
 * ally-ai-learn/app/core/graph/prompt.py.
 *
 * `Prompt.availableVariables` is the *used* subset (auto-reconciled from
 * the prompt text on every save). The studio's prompt editor cross-
 * references the two so admins can see which catalog entries are not
 * currently referenced by the prompt — they're "available but not used".
 *
 * Adding a new field is a coordinated FE + BE + prompt-builder change
 * (see plan directive #4): extend `_build_behavior_prompt`'s kwargs and
 * add a matching entry here so the studio surfaces it for discovery.
 */
export interface PromptCatalogEntry {
  name: string;
  label: string;
  /** Loose grouping used for the studio's "available" list rendering. */
  group: "scenario" | "persona" | "character" | "behavior" | "system";
  /**
   * When true, this slot is only meaningful for prompts opting in via
   * `hasStates: true`. The studio uses this to hide state-only entries
   * from the "available" list for prompts that don't have States enabled.
   */
  statesOnly?: boolean;
  /**
   * When true, this placeholder is filled by the prompt builder from
   * computed sources (RAG context, sub-prompt blocks, behavior rules
   * JSON), not from a studio-editable field. Useful for discovery, but
   * not surfaced as something the admin needs to "supply".
   */
  systemComputed?: boolean;
}

/**
 * The placeholder catalog for main-agent prompts. Keep aligned with the
 * kwargs passed to `load_and_format("system/main_agent_prompt", …)` in
 * `_build_behavior_prompt`.
 */
export const MAIN_AGENT_PROMPT_VARIABLE_CATALOG: PromptCatalogEntry[] = [
  // Scenario meta
  { name: "title", label: "Title", group: "scenario" },
  { name: "challenge_description", label: "Challenge Description", group: "scenario" },
  { name: "role_instructions", label: "Role Instructions", group: "scenario" },

  // Persona (identity)
  { name: "name", label: "Name", group: "persona" },
  { name: "age", label: "Age", group: "persona" },
  { name: "gender", label: "Gender", group: "persona" },
  { name: "current_location", label: "Current Location", group: "persona" },
  { name: "gender_identity", label: "Gender Identity", group: "persona" },
  { name: "sexual_orientation", label: "Sexual Orientation", group: "persona" },
  // Lifted from profession_block; variants can use {profession} directly
  // (e.g. "Currently working as {profession}") instead of the canned
  // "Your profession is X" wrapper.
  { name: "profession", label: "Profession", group: "persona" },

  // Character (interior life + backstory)
  //
  // Note: the structured `personality`, `tone`, `starting_state`,
  // `emotional_needs`, `life_history_summary`, `core_memories` placeholders
  // were originally part of this group (PR #350, Oct 2025) but their UI
  // inputs were removed Jan 2026 ("Remove deprecated simulation step
  // constants") and the BE/runtime plumbing followed in a later cleanup.
  // The author-facing equivalent is now the free-text Character Backstory
  // field, which captures all of these as one paragraph. Its old placeholder
  // name, `character_profile_text`, still renders (see LEGACY_VARIABLE_NAMES).
  { name: "character_backstory", label: "Character Backstory", group: "character" },
  // Lifted from previous_memory_block; variants can use {previous_memory}
  // directly instead of the canned "Summary from your previous session: X"
  // wrapper.
  { name: "previous_memory", label: "Previous Memory", group: "character" },

  // `competency` and `opening_statements` are deliberately absent: both are
  // scenario fields (the skill being trained; what the client says first),
  // not actor direction, so they are not offered as prompt variables. So is
  // `behavior_instructions_json`, which only Prompt #1's legacy per-state
  // coaching uses; #1's own text still references it.

  // System-computed (filled by the prompt builder, not the studio)
  //
  // Composed sub-template *blocks* (profession_block, previous_memory_block,
  // multilingual_instructions_block) are deliberately NOT in this catalog
  // anymore. They surface separately in the "Used Blocks" panel — listing
  // them here too caused them to show up under the variables picker AND
  // under the blocks panel, which confused authors about which scope they
  // belong to. Blocks are still referenceable in prompt text (the prompt
  // builder substitutes them), they just aren't advertised in the
  // variables list.
  //
  // Multilingual block-internal variables. Variants can compose their own
  // brief multilingual hint using these instead of the full block, e.g.
  // "Reply in {language_label} ({language_code})."
  {
    name: "language_code",
    label: "Language Code (BCP-47)",
    group: "system",
    systemComputed: true,
  },
  {
    name: "language_label",
    label: "Language Label",
    group: "system",
    systemComputed: true,
  },
  {
    name: "language_characteristics",
    label: "Language Characteristics",
    group: "system",
    systemComputed: true,
  },
  // Style / voice fields lifted from the multilingual block when the
  // "Main Agent Prompt #2" variant landed. Variants can now reference
  // `{linguistic_samples}` and `{allowed_fillers}` directly in their body without
  // pulling in the full `{multilingual_instructions_block}` wrapper.
  {
    name: "linguistic_samples",
    label: "Tone & Style Samples",
    group: "system",
    systemComputed: true,
  },
  {
    name: "allowed_fillers",
    label: "Allowed Filler Words",
    group: "system",
    systemComputed: true,
  },
  {
    name: "helpful_behaviours",
    label: "Helpful Behaviours",
    group: "behavior",
    systemComputed: true,
  },
  {
    name: "unhelpful_behaviours",
    label: "Unhelpful Behaviours",
    group: "behavior",
    systemComputed: true,
  },
  {
    name: "retrieved_context",
    label: "Retrieved Context (RAG)",
    group: "system",
    systemComputed: true,
  },
  {
    name: "custom_fields_text",
    label: "Custom Fields",
    group: "system",
    systemComputed: true,
  },
  {
    name: "state_x_guidelines",
    label: "Active State Guidelines",
    group: "system",
    systemComputed: true,
    statesOnly: true,
  },
];

/**
 * Old placeholder names that still render, mapped to the name authors should
 * use now. Live versions written before a rename keep working; the studio
 * just stops offering the old name.
 */
export const LEGACY_VARIABLE_NAMES: Record<string, string> = {
  character_profile_text: "character_backstory",
};

/**
 * Variables whose value the runtime uses even when the prompt text leaves the
 * placeholder out, and how. Shown as a tooltip on the variable's chip so an
 * author doesn't take "not in my prompt" to mean "safe to leave empty".
 * Keyed by placeholder name, not limited to the catalog: the glossary is a
 * fragment, not a catalog entry, and behaves the same way.
 */
export const VARIABLES_USED_OUTSIDE_THE_PROMPT: Record<string, string> = {
  character_backstory:
    "Used even if this prompt leaves it out: working memory recalls the client's backstory from it a few facts at a time, and guardrail replies include it.",
  retrieved_context:
    "Used even if this prompt leaves it out: retrieved knowledge-source text is added after the conversation every turn, unless the current state turns knowledge retrieval off.",
  language_glossary:
    "Used even if this prompt leaves it out: the glossary is added to the end of the prompt when the text doesn't place it.",
  allowed_fillers:
    "Used even if this prompt leaves it out: when fillers are on for the simulation, these words are played as spoken fillers before a reply and guide the thinking fillers.",
  linguistic_samples:
    "Used even if this prompt leaves it out: thinking fillers are written to match these samples, and guardrail replies include them.",
  previous_memory:
    "Used even if this prompt leaves it out: working memory reads it so the client doesn't treat what they said in earlier sessions as new.",
  state_x_guidelines:
    "Used even if this prompt leaves it out: the states still set working memory's stage for the client and switch knowledge retrieval on or off per state.",
  challenge_description:
    "Used even if this prompt leaves it out: it gives context to thinking fillers, back-channel sounds and interim replies, and working memory falls back on it when recalling backstory.",
  title:
    "Used even if this prompt leaves it out: it gives context to thinking fillers, back-channel sounds and interim replies.",
  name: "Used even if this prompt leaves it out: it gives context to thinking fillers, back-channel sounds and interim replies, and guardrail replies include it.",
  profession:
    "Used even if this prompt leaves it out: it gives context to thinking fillers, back-channel sounds and interim replies.",
};

/** Human-readable header for a catalog group. */
export const PROMPT_CATALOG_GROUP_LABELS: Record<PromptCatalogEntry["group"], string> = {
  scenario: "Scenario",
  persona: "Persona",
  character: "Character",
  behavior: "Behavior & Session",
  system: "System-computed",
};
