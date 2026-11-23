/**
 * Stage 2 (six sections, two-option home, corner menu). New strings live here, not in `HOME`,
 * which `copy.test.ts` holds word for word to the onboarding deck.
 * Every line below is new wording. // COPY: needs approval
 */
export const STRUCTURE = {
  sections: {
    overview: "Overview",
    build: "Build",
    conversations: "Conversations",
    channels: "Channels",
    knowledge: "Knowledge",
    settings: "Settings",
  },
  subtitles: {
    build: "How your chatbot introduces itself and talks, and a check that it answers well.",
    channels: "Where people reach your chatbot, and who can open each one.",
    knowledge: "What your chatbot answers from, and your own lists.",
    settings: "Safety, quick replies, hand over, memory, your team and removing the chatbot.",
  },
  parts: {
    personality: "Personality",
    checkup: "Check-up",
    knows: "What it knows",
    lists: "Lists",
  },
  partsLabel: "Parts of this section",
  channels: {
    pagesTitle: "Your pages",
    shareLinkTitle: "Link and QR code",
  },
  settings: {
    safetyTitle: "Safety",
    repliesTitle: "Quick replies",
    repliesHint: "Fixed replies for the messages people send most.",
    howTitle: "How it works",
    handoverTitle: "Hand over",
    memoryTitle: "Memory",
    peopleTitle: "People and seats",
    archivedTitle: "What an archived chatbot says",
    archivedHint:
      "Shown to anyone who messages this chatbot after you archive it. The crisis link is always added and can't be removed.",
    archivedPlaceholder: "This chatbot is no longer available.",
    archiveTitle: "Archive or remove",
  },
} as const;
