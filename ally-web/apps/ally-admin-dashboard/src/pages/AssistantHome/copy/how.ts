/** How it works and Why this answer (chunk 20d-2, deck §25); part of `HOME`. */

export const HOW = {
  intro:
    "Everything your assistant follows, in the order it applies. You can edit the parts marked as yours.",
  locked:
    "Set by Ally to keep answers accurate and safe. You can add to safety rules, not remove them.",
  yours: "Yours",
  byAlly: "Set by Ally",
  showText: "Show exact text",
  hideText: "Hide exact text",
  showFull: "Show the full instructions",
  hideFull: "Hide the full instructions",
  fullHint:
    "This is the whole text your assistant gets, with your parts highlighted. Where it says {question}, it gets the visitor's message; the parts of your pages it finds go in for each question.",
  editHere: "Edit",
  editIn: "Edit in {section}",
  counter: "{n} of {max} characters",
  warning:
    "Saved. Your assistant still follows its safety and base rules first, so text that tries to override them has no effect.",
  unavailable: "We couldn't load this. Try again in a moment.",
  none: "Nothing here yet.",
  layers: {
    base: {
      title: "Ally's base rules",
      summary:
        "Answer from your pages, say where each answer came from, never make things up, and say plainly when it doesn't know.",
    },
    safety: {
      title: "Safety rules",
      summary: "Always on for {pack}. Your own rules are added after Ally's.",
    },
    purpose: {
      title: "What it's for",
      summary: "Set by the purpose you chose: {purpose}. Change it by choosing another purpose.",
    },
    business: {
      title: "Business details",
      summary: "The name your assistant uses.",
    },
    tone: {
      title: "Tone and style",
      summary: "How it sounds.",
    },
    instructions: {
      title: "Your instructions",
      summary: "Anything else it should know or do. Safety and base rules always come first.",
    },
    avoid: {
      title: "Topics to avoid",
      summary: "Subjects it politely declines.",
    },
    search: {
      title: "How it finds answers",
      summary:
        "Searches your pages up to {searches} times a question and uses the best {passages} parts it finds, from {documents} documents.",
    },
  },
  packAny: "your kind of practice",
  purposeNone: "answering questions",
  instructionsLabel: "Anything else it should know or do",
} as const;

export const WHY = {
  toggle: "Why this answer?",
  hide: "Hide",
  passages: "Where it looked",
  none: "It didn't use any of your pages for this.",
  time: "{s} s to answer",
  avoid: "Topics to avoid: {topic}",
  declined: "It said it didn't know.",
} as const;
