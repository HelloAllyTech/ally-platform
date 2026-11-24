/**
 * The Overview's "how it's doing" card (stage 7). Its own object, not part of HOME: HOME is held
 * word for word to docs/agents-v2/ONBOARDING-COPY.md by copy.test.ts.
 */
// COPY: needs approval. Every line below is new wording.
export const OVERVIEW_COPY = {
  title: "How it's doing",
  period: "Show the last",
  last7: "7 days",
  last30: "30 days",
  last90: "90 days",
  loadFailed: "Couldn't load these numbers.",
  retry: "Try again",
  empty: "Nobody has chatted yet. Numbers show up here after the first conversations.",
  conversations: "Conversations",
  people: "People",
  overTime: "Over time",
  overTimeLabel: "{label} per day, last {n} days",
  lowDaysNote: "Days with fewer than 5 are drawn at the bottom, so nobody can be picked out.",
  answered: "Answered from your information",
  answeredNote: "Of the questions it was asked",
  answeredTooFew: "Fewer than 5 questions, too few to say",
  handed: "Handed to a person",
  handedWait: "Typical wait for a reply: {n}",
  handedWaitNone: "No wait time yet",
  minutes: "{n} min",
  hours: "{n} h",
  ratings: "Ratings",
  thumbsUp: "{n} thumbs up",
  thumbsDown: "{n} thumbs down",
  lessThan: "Fewer than 5",
  none: "None",
  topUnanswered: "Questions it couldn't answer",
  topUnansweredNone: "Nothing it couldn't answer in this time.",
  askedTimes: "Asked {n} times",
  themeNote: "Groups of fewer than 5 people are shown as a topic only, never as someone's words.",
  themes: {
    no_hits: "Nothing in your information matched",
    below_threshold: "Nothing matched closely enough",
    model_declined: "It chose not to answer",
    error: "Something went wrong on our side",
    conflict: "Two of your sources disagree",
  } as Record<string, string>,
  themeOther: "Other",
  themeLine: "{theme}: {count}",
  staleTitle: "Your information may be out of date",
  staleBody: "Last read {n} days ago. Read it again to pick up changes to your website.",
  readAgain: "Read again",
  reading: "Reading",
  readDone: "Read again. It's up to date.",
  readChanged: "Read again. It found changes and is learning them.",
  readFailed: "Couldn't read it again. Try again.",
} as const;

// COPY: needs approval. The live line of an invite-only assistant: who can chat, with a link to Channels.
export const LIVE_ACCESS_COPY = {
  live: "Your assistant is live for the people on its Who may chat list.",
  nobody: "Nobody can chat yet: add people under Who may chat in Channels.",
  link: "Open Channels",
  widgetNote: "Only people on your Who may chat list can chat in the bubble.",
};
