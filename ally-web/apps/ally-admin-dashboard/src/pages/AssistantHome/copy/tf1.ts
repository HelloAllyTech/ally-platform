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
} as const;
