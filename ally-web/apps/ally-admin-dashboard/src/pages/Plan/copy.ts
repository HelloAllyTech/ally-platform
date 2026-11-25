/**
 * The owner's words for plans, seats and limits (CR1 Part C, docs/agents-v2/chunk-cr1.md §C3):
 * Plan and usage, Share → People's seats, and publishing. One amount is in dollars, the monthly
 * usage allowance; **never a price**.
 */
export const PLAN = {
  title: "Plan and usage",
  intro: "Your plan, your seats and this month's use. Ally sets plans and seats for now.",
  loading: "Loading…",
  loadFailed: "Couldn't load your plan. Refresh to try again.",
  notCreator: "You don't have a plan. Plans belong to the person who creates assistants.",
  menuItem: "Plan and usage",
  upgrade: {
    action: "Ask Ally to upgrade",
    how: "Plans and seats are set by Ally for now. To upgrade or add seats, ask your contact at Ally.",
  },
  status: {
    active: "",
    past_due: "Payment is due",
    cancelled: "Cancelled",
  } as Record<string, string>,
  usage: {
    title: "Monthly usage",
    label: "Used this month",
    stops:
      "When this is used up, your assistants stop answering until it resets. Crisis replies still go out. To raise it, ask Ally.",
    stopped:
      'This month\'s usage is used up, so your assistants give a short "not available" reply until it resets. Crisis replies still go out. To raise it, ask Ally.',
  },
  month: {
    title: "This month",
    ownerRuns: "Setup and checkups",
    ownerRunsHint: "Setup steps, site reading, checkups, changes by chat and re-indexing.",
    customers: "Customer conversations",
    resets: (day: string) => `Resets ${day}`,
    unlimited: "Unlimited",
    of: (used: string, limit: string) => `${used} of ${limit}`,
    used: (used: string) => `${used} used`,
  },
  assistants: {
    title: "Assistants",
    none: "No assistants yet.",
    published: "Published",
    draft: "Not published",
    open: "Open Share",
  },
  seats: {
    title: "Seats",
    hint: "Each person you invite to chat with the assistant uses a seat. Public and WhatsApp customers don't.",
    included: "Included",
    extra: "Extra",
    unassigned: (n: number) => `${n} seat${n === 1 ? "" : "s"} not given to anyone`,
    free: "Not given to anyone",
    renews: (day: string) => `Renews ${day}`,
    since: (day: string) => `Since ${day}`,
    messages: "Messages",
    /** "Basic · 500 messages a month": what the seat type gives, in words. */
    allowance: (type: string, messages: string) => `${type} · ${messages} messages a month`,
    status: {
      active: "",
      expiring: "Renews soon",
      lapsed: "Lapsed",
      cancelled: "Cancelled",
    } as Record<string, string>,
    noSeats: "No seats yet. They're added when the assistant is published.",
    notRequired: "People you invite don't need a seat on your plan.",
    giveSeat: "Give them a seat",
    holder: "Who has it",
    holderLabel: (seat: string) => `Who has seat ${seat}`,
    nobody: "Nobody",
    ownerOnly: "Only the assistant's authors can give or move seats.",
    saved: "Seat updated.",
    failed: "That seat didn't change. Try again.",
    noSeatBadge: "No seat",
  },
  alerts: {
    title: "Close to a limit",
    line: (what: string, percent: number) =>
      percent >= 100 ? `${what}: used up` : `${what}: ${percent}% used`,
    more: "See Plan and usage",
  },
  publish: {
    uses: (n: number, max: number) => `This uses ${n} of your ${max} assistants.`,
  },
};
