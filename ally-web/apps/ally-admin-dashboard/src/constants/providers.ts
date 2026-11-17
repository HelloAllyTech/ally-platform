/**
 * Copy for the Providers page and the shared "which setting wins" explainer.
 * Kept out of en.ts so screens that only need it still render when a test mocks
 * `@constants` wholesale.
 */
export const providersCopy = {
  title: "Providers",
  intro:
    "The vendors and models behind speech recognition, language models and voices. Languages and simulations point at a row here, so one edit changes every place that uses it.",
  tabs: { speech: "Speech Recognition", models: "Language Models", voices: "Voices" },
  precedence: {
    summary: "Which setting wins?",
    intro:
      "A model is chosen when each request runs, by the first layer below that has a value. Later layers override earlier ones:",
    layers: [
      { label: "Code default", detail: "the model the service ships with, set per AI task." },
      { label: "Language", detail: "the model chosen on the language (Languages screen)." },
      { label: "Prompt", detail: "the model set on the prompt itself (Prompts screen)." },
      {
        label: "Request or simulation override",
        detail: "an explicit model on one request, or on a simulation. Always wins.",
      },
    ],
  },
};

/** Copy for "Test this prompt" in the Prompts editor. */
export const promptTestCopy = {
  title: "Test this prompt",
  hint: "Runs the text above — including edits you have not saved — against a sample on the model you pick. Nothing is saved, and the call is billed like any model call.",
  sampleLabel: "Sample input",
  samplePlaceholder:
    "What the user (or the variable block) would send, e.g. “I keep freezing when a client cries.”",
  modelLabel: "Run on",
  run: "Run test",
  running: "Running…",
  emptyPrompt: "Write some prompt text first.",
  noModels: "No active catalog models. Add one under Providers → Language Models.",
  failed: "The model rejected the call",
};
