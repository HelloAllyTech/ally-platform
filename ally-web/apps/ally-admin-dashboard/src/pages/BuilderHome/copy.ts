/**
 * The builder's home (stage 2): two choices, Create and Open. All new wording. // COPY: needs approval
 */
export const BUILDER_HOME = {
  title: "Your chatbots",
  subtitle: "Create a new chatbot, or open one you already work on.",
  create: {
    title: "Create a chatbot",
    body: "Start from a template or from scratch, and test it as you build.",
    button: "Create a chatbot",
    openLink: "Back to your chatbots",
  },
  open: {
    title: "Open a chatbot",
    emptyTitle: "No chatbots to open yet",
    emptyMember: "You haven't been added to a chatbot yet. Ask its owner to add you.",
    emptyCreate: "Create your first chatbot above.",
    loadFailed: "Could not load your chatbots.",
  },
  showArchived: "Show archived",
  archivedLoadFailed: "Could not load the archived chatbots.",
  waiting: "{count} waiting for a person",
  narrow: {
    title: "Open this on a laptop to create a chatbot",
    body: "Creating a chatbot needs a wider screen. Open Ally on a laptop or desktop to create one, then manage it from any device.",
  },
} as const;

/** Create needs room for the build screen: below this width it is not offered. */
export const CREATE_MIN_WIDTH = 1280;
