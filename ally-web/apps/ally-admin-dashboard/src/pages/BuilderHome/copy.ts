/**
 * The builder's home (stage 2): the chatbots to open, and a Create button in the header. All new wording. // COPY: needs approval
 */
export const BUILDER_HOME = {
  title: "Your Ally Chatbots",
  create: {
    button: "Create new chatbot",
    openLink: "Back to your chatbots",
  },
  tabs: {
    label: "Show chatbots",
    all: "All",
    active: "Active",
    archived: "Archived",
  },
  open: {
    emptyTitle: "No Ally Chatbots here 😮",
    emptyMember: "You haven't been added to a chatbot yet. Ask its author to add you.",
    emptyCreate: "Create your first Ally chatbot and change the world 🚀",
    loadFailed: "Could not load your chatbots.",
  },
  archivedLoadFailed: "Could not load the archived chatbots.",
  waiting: "{count} waiting for a person",
  narrow: {
    title: "Open this on a laptop to create a chatbot",
    body: "Creating a chatbot needs a wider screen. Open Ally on a laptop or desktop to create one, then manage it from any device.",
  },
} as const;

/** Create needs room for the build screen: below this width it is not offered. */
export const CREATE_MIN_WIDTH = 1280;
