/**
 * TF1's new owner-facing wording, in one place (docs/agents-v2/TEXTS-TF1.md holds the same lines
 * for one approval).
 */
// COPY: needs approval. Every line below is new wording.
export const TF1_COPY = {
  overview: {
    /** S1: a never-published assistant goes live from Build, where the checklist is. */
    finishToGoLive: "Finish setup and go live",
    turnOnFailed: "Couldn't turn it on. {reason}",
    turnOnFailedNoReason: "Couldn't turn it on. Try again.",
  },
  goLive: {
    /** S2: replies are paid from the assistant's budget; going live sets aside a starting one. */
    budgetAdded:
      "We set aside ${amount} of your free credits so it can answer people. Change this in Settings, under Budget.",
    budgetNone:
      "It can't answer anyone yet: no credits are set aside for it. Add some in Settings, under Budget.",
  },
  helpline: {
    /** S4: a template-written helpline number waits for the owner's confirmation. */
    waiting:
      "Your helpline number ({numbers}) isn't in crisis replies yet. Check it's right, then confirm it.",
    confirm: "Use it in crisis replies",
    confirmed: "Crisis replies now give {numbers} beside the national numbers.",
    failed: "Couldn't confirm it. Try again.",
  },
  create: {
    /** S6: Create's Pick a template shows the use-case templates; the older starting points below. */
    moreStartingPoints: "More starting points",
  },
  inbox: {
    /** S5: one row per person. */
    chats: "{n} chats",
    otherChats: "Their other chats",
    newerChat: "They've started a newer chat. Reply there so they see it.",
    openNewer: "Open their latest chat",
    /** A chat the crisis check flagged showed "Needs a person · undefined". */
    crisisReason: "May be at risk",
  },
  sources: {
    /** F4: a file held for personal details, where it was added (was a raw "needs_review"). */
    held: "Waiting for you: check it for personal details below",
  },
  list: {
    /** F5: a card for an assistant still in setup also opens its home. */
    openHome: "Knowledge, lists and settings",
  },
  access: {
    /** B2: who can chat, in one plain line, in Channels (the cover says the same to visitors). */
    invite: "Who can chat: only the people on this list. Share the link with them yourself.",
    organisation: "Who can chat: people in your organisation, after they confirm their work email.",
    public: "Who can chat: anyone with the link.",
    /** Public shown as a choice, switched off for now (25 Nov). */
    publicChoice: "Public",
    publicChoiceLabel: "Public (off for now)",
    publicChoiceHint: "Anyone with the link can chat, with no sign-in. Off for now.",
    /** A page that is public already (set before this choice existed). */
    publicNow:
      "This page is public now. Choose Invite only to let only the people on this list chat.",
    emptyWhilePublic:
      "Nobody is on the list. While the page is public, the list isn't used: anyone with the link can chat.",
    sitesHintPublic:
      "The chat bubble can go on any website. These are the sites it has appeared on. While your page is public, anyone can chat there without signing in.",
    switchFailed: "Couldn't change who can chat. Try again.",
  },
} as const;
