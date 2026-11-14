/**
 * Memory (chunk 8a): the owner's switch and its never-store list in How it works, and Try it's
 * line, from `docs/agents-v2/ONBOARDING-COPY.md` §28, word for word. The Inbox's lines are in
 * `pages/Inbox/copy.ts` (`INBOX.memory`).
 */
export const MEMORY = {
  switchLabel: "Remember people between chats",
  switchHint:
    'Your assistant keeps short notes about each person, like "prefers evenings", and uses them next time. You can see and forget every note in the Inbox.',
  neverLabel: "It never remembers:",
  alwaysOn: "Always on this list",
  addHint: "Add something it should never remember",
  add: "Add",
  remove: "Remove {item}",
  upTo: "Up to 20 of your own.",
  wouldRemember: "Would remember: {line}",
} as const;
