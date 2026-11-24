/**
 * Assistants stage 8: the words of Ally staff's read-only view and the owner's "Ally support"
 * settings. A new copy object (never the onboarding COPY, which copy.test.ts checks against
 * ONBOARDING-COPY.md). Every string here is new wording.
 */

// COPY: needs approval
export const STAFF_SUPPORT_COPY = {
  page: {
    title: "Chatbot support",
    subtitle:
      "Find any chatbot and open it read-only. Every view is logged and its owners can see it.",
    searchLabel: "Chatbot name, or owner name or email",
    searchButton: "Search",
    empty: "No chatbots match that.",
    failed: "Couldn't search just now. Try again.",
    loading: "Searching…",
    open: "Open read-only",
    owners: "Owners: {names}",
    noOwner: "No owner",
    archived: "Archived",
    conversationsAllowed: "Conversations allowed by the owner",
    back: "Back to search",
  },
  banner: {
    title: "Read-only staff view, every view is logged",
    body: "The owners can see who looked and when. Conversations, memory and contacts open only while an owner allows it.",
  },
  owner: {
    title: "Ally support",
    hint: "Ally staff can view this chatbot's setup to help you, never change it. Every look is listed below. They read conversations only while you allow it.",
    allowLabel: "Let Ally staff read conversations for",
    durations: [
      { hours: 1, label: "1 hour" },
      { hours: 24, label: "24 hours" },
      { hours: 72, label: "3 days" },
      { hours: 168, label: "7 days" },
    ],
    reasonLabel: "Why (optional)",
    allow: "Allow",
    allowing: "Allowing…",
    liveUntil: "Ally staff can read conversations until {when}.",
    noneLive: "Ally staff can't read conversations.",
    revoke: "Stop now",
    revoked: "Stopped. Ally staff can no longer read conversations.",
    failed: "That didn't work. Try again.",
    viewsTitle: "Who looked",
    viewsEmpty: "No one from Ally has looked at this chatbot.",
    viewsFailed: "Couldn't load who looked.",
    viewRow: "{who} looked at {what}",
    someone: "Ally staff",
    conversationTag: "conversation",
    ownersOnly: "Only this chatbot's owners can change this.",
  },
} as const;

/**
 * The staff read-only Conversations section: no grant, the read-only banner and the grant's
 * expiry. Every string is new wording.
 */
// COPY: needs approval
export const STAFF_CONVERSATIONS_COPY = {
  checking: "Checking whether the owner allows this…",
  checkFailed: "Couldn't check whether the owner allows this. Try again.",
  retry: "Try again",
  noGrant:
    "The owner hasn't given Ally staff access to conversations. Ask them to allow it under Settings, Ally staff access.",
  banner: "Read-only. This view is logged and the owner can see it.",
  until: "The owner allows this until {when}.",
} as const;
