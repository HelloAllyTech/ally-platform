import type { CustomerOrgRow, CustomerReason } from "@types";

/**
 * A message Ally staff can copy and send to an organisation. English only: it is
 * the staff member's own message, which they edit before sending, and the
 * organisation's language is not known here. One line per reason, from the same
 * numbers the reason shows; nothing about an individual learner.
 */
const LINES: Record<CustomerReason["id"], (p: Record<string, number>) => string> = {
  neverActive: p =>
    `${p.learners} learner${p.learners === 1 ? " has" : "s have"} signed up, but nobody has completed a session yet.`,
  quiet: p => `There has been no completed session for ${p.days} days.`,
  neverStarted: p =>
    `${p.count} learner${p.count === 1 ? "" : "s"} (${p.percent}%) ${p.count === 1 ? "has" : "have"} not completed a session yet.`,
  activityDown: p =>
    `Practice has slowed: ${p.to} sessions in the last 28 days, against ${p.from} in the 28 before.`,
  reviewsBehind: p => `Only ${p.percent}% of recent sessions have been reviewed.`,
  creditsNearLimit: p => `${p.percent}% of your simulation credits have been used.`,
  lowRating: p => `Learners are rating their sessions ${p.average} out of 5 on average.`,
  activityUp: p =>
    `Practice is picking up: ${p.to} sessions in the last 28 days, up from ${p.from}.`,
};

export const draftMessage = (org: Pick<CustomerOrgRow, "name" | "reasons">): string => {
  const lines = org.reasons
    .filter(r => r.polarity === "attention")
    .map(r => `- ${LINES[r.id](r.params)}`);
  return [
    `Hi ${org.name} team,`,
    "",
    "I was looking at how practice is going on Ally and noticed:",
    ...lines,
    "",
    "Is there anything we can do to help? I'm happy to jump on a short call this week.",
  ].join("\n");
};
