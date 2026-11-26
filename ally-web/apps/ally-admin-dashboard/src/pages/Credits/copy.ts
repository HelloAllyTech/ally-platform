/**
 * Credits (stage 6): the builder's Credits page, a chatbot's Budget and limits, and Ally admin ->
 * Credits. New strings only, never inside `COPY`.
 * Every line below is new wording. // COPY: needs approval
 */
export const CREDITS_COPY = {
  title: "Plan and credits",
  intro: "What you have been given, what has been used, and what is set aside for your chatbots.",
  loading: "Loading…",
  loadFailed: "Couldn't load your credits. Refresh to try again.",
  noAccount: "You don't have any credits yet. Contact Ally to get started.",
  totals: {
    granted: "Granted",
    used: "Used",
    free: "Free balance",
    freeHint: "Pays for building and testing. Never touches what is set aside for customers.",
    setAside: "Set aside for chatbots",
    setAsideHint: "Kept for your customers' conversations, chatbot by chatbot.",
  },
  low: {
    title: "Your free balance is low",
    body: "When it reaches zero you can't build or test until you have more credits. Chatbots that are live keep answering from what is set aside for them.",
    empty:
      "Your free balance is used up. You can't build or test right now. Chatbots that are live keep answering from what is set aside for them.",
  },
  more: {
    title: "Need more credits?",
    body: "Contact Ally for more credits. Tell us how many you need and which chatbot they are for.",
    action: "Contact Ally for more credits",
    /** Shown when the button is pressed: we give no address, they have their own contact. */
    reply:
      "Please reach out to your contact at Ally. Tell them how many credits you need and which chatbot they are for.",
  },
  paused: {
    title: "Some work is waiting for credits",
    body: "These jobs stopped because your free balance ran out. They carry on by themselves once you have more credits; nothing is lost.",
    jobs: {
      site_reading: "Reading your website",
      indexing: "Indexing your knowledge",
      checkup: "Check-up",
      setup: "Setting up",
    } as Record<string, string>,
    since: (day: string) => `waiting since ${day}`,
  },
  spend: {
    title: "Where credits went (last 90 days)",
    byTask: "By kind of work",
    byChatbot: "By chatbot",
    byDay: "By day",
    empty: "Nothing used yet.",
    axis: "Credits used ($)",
    other: "Other",
    deleted: "Removed chatbot",
    tasks: {
      customer_reply: "Replies to customers",
      crisis_check: "Safety checks",
      memory_check: "Memory",
      summary: "Summaries",
      setup: "Setting up",
      site_reading: "Reading your website",
      indexing: "Indexing knowledge",
      checkup: "Check-up",
      judge: "Judging answers",
      change_by_chat: "Changes by chat",
      try_it: "Try it",
      instructions: "Instruction checks",
      whatsapp: "WhatsApp",
      other: "Other",
    } as Record<string, string>,
  },
  budgets: {
    title: "Set aside for each chatbot",
    columns: { chatbot: "Chatbot", setAside: "Set aside", used: "Used", left: "Left" },
    none: "Nothing is set aside yet. Open a chatbot's Settings, then Budget and limits.",
    open: "Open",
    archived: "archived",
  },
  grants: {
    title: "Credits you were given",
    columns: { when: "When", kind: "Kind", amount: "Amount", note: "Note", by: "By" },
    none: "No credits granted yet.",
    kinds: { grant: "Grant", adjustment: "Adjustment", cutover: "Starting credits" } as Record<
      string,
      string
    >,
    ally: "Ally",
  },
  planLink: "Seats and plan",
} as const;

/** A chatbot's Settings -> Budget and limits. // COPY: needs approval */
export const BUDGET_COPY = {
  title: "Budget and limits",
  hint: "Credits you set aside pay for your customers' conversations with this chatbot. Building and testing use your free balance instead.",
  loadFailed: "Couldn't load the budget. Refresh to try again.",
  current: {
    setAside: "Set aside",
    used: "Used",
    left: "Left",
    // COPY: needs approval (TF1 round 2)
    /** N-12: what replies still running hold, so Set aside − Used − Held = Left adds up. */
    held: "Held for replies in progress",
    free: "Your free balance",
  },
  noBudget: {
    title: "No budget yet",
    body: "Until you set something aside, people who message this chatbot see a fixed notification with crisis information instead of an answer. Set aside some credits to let it answer.",
  },
  out: {
    title: "Out of credits",
    body: "This chatbot has used what was set aside, so people see the fixed notification with crisis information instead of an answer. Add credits to let it answer again.",
  },
  topUp: {
    label: "Add from your free balance",
    placeholder: "Amount in dollars",
    action: "Add credits",
    invalid: "Enter an amount above $0.",
    over: (free: string) =>
      `You only have ${free} free. Add less, or contact Ally for more credits.`,
  },
  setAside: {
    label: "Set the total set aside",
    action: "Save amount",
    hint: "Lowering it gives back what is unspent. It can't go below what is already used.",
    invalid: "Enter $0 or more.",
  },
  warn: (reserve: string, left: string) =>
    `This would leave ${left} in your free balance, under ${reserve}. You'd have little to build and test with.`,
  clamped: "It can't go below what is already used, so it was set to that.",
  saved: "Saved.",
  failed: "Couldn't save. Try again.",
  limits: {
    title: "Limit per person",
    hint: "The most one person can use of this chatbot's budget. Leave empty for no limit. Someone who reaches a limit sees the fixed notification until the period ends.",
    daily: "Per day ($)",
    weekly: "Per week ($)",
    monthly: "Per month ($)",
    action: "Save limits",
    invalid: "Limits are $0 or more, or empty for none.",
  },
} as const;

/** Ally admin -> Credits (staff, `manage_costs`). // COPY: needs approval */
export const STAFF_CREDITS_COPY = {
  title: "Credits",
  intro:
    "Every builder's credits. Grant or adjust them, move a chatbot's budget, and run the cutover.",
  loadFailed: "Couldn't load credits.",
  accounts: {
    title: "Builder accounts",
    search: "Search by name or email",
    columns: {
      builder: "Builder",
      status: "Status",
      granted: "Granted",
      setAside: "Set aside",
      used: "Used for building",
      free: "Free balance",
    },
    none: "No accounts match.",
    open: "Open ledger",
  },
  ledger: {
    back: "All accounts",
    title: "Ledger",
    spendTitle: "Spend by kind of work (90 days)",
    budgets: "Budgets",
    grants: "Grants and adjustments",
    none: "Nothing here yet.",
  },
  grant: {
    title: "Grant or adjust credits",
    kind: "Kind",
    grant: "Grant (add credits)",
    adjustment: "Adjustment (add or take away)",
    amount: "Amount in dollars",
    amountHint:
      "Negative only for an adjustment. An adjustment can't take the account below what it has spent and set aside.",
    note: "Note (required)",
    action: "Save",
    needNote: "A note is required.",
    needAmount: "Enter an amount.",
    negativeGrant: "A grant is above $0. Use an adjustment to take credits away.",
    done: "Saved.",
    failed: "Couldn't save. Check the amount and try again.",
  },
  transfer: {
    title: "Move a chatbot's budget",
    chatbot: "Chatbot",
    toUser: "To builder (user id)",
    action: "Move budget",
    done: "Moved.",
    failed: "Couldn't move it.",
    needUser: "Enter the user id of the builder who receives it.",
    none: "This account has no budgets to move.",
  },
  cutover: {
    title: "Cutover grant",
    body: "Gives every current builder the starting credits and every live chatbot its starting budget. Run the dry run first; it changes nothing.",
    dry: "Dry run",
    run: "Run the cutover",
    confirm: "Run it for real? This grants credits to every builder and can't be undone from here.",
    failed: "The cutover failed.",
    report: {
      dryTitle: "Dry run (nothing changed)",
      doneTitle: "Cutover done",
      credits: "Starting credits",
      budget: "Starting budget",
      builders: "Builders granted",
      budgets: "Budgets set",
      skipped: "Skipped",
      total: "Total granted",
    },
  },
} as const;

/** Channels -> Who may chat. // COPY: needs approval */
export const ACCESS_COPY = {
  title: "Who may chat",
  hint: "Only the people you add here can chat with this chatbot. Removing someone takes effect at once.",
  mode: {
    label: "Who can chat",
    listed: "Invite only",
    listedHint: "Only people on this list.",
    note: "Invite only is the one option for now.",
  },
  add: {
    label: "Add phone numbers or emails",
    placeholder: "+919812345678 or name@example.com, one per line or separated by commas",
    hint: "Phone numbers need the country code, like +91 98123 45678. We save them as +919812345678.",
    action: "Add to list",
    nothing: "Type at least one phone number or email.",
    invalid: (value: string) => `"${value}" is not a phone number with a country code or an email.`,
    added: (n: number, skipped: number) =>
      `Added ${n}${skipped > 0 ? `, ${skipped} already on the list` : ""}.`,
    failed: "Couldn't add them. Try again.",
  },
  whatsappNote:
    "People added by phone number only can reach you on WhatsApp, and only through this chatbot's own WhatsApp number. Connect one under Channels if you haven't.",
  list: {
    empty: "Nobody is on the list yet. Until you add someone, nobody can chat.",
    columns: { who: "Who", kind: "Kind", status: "Status" },
    kinds: { phone: "Phone", email: "Email", user: "Ally user", organisation: "Organisation" },
    // COPY: needs approval (TF1 round 2). Signed in: they proved this email or number to the
    // assistant. Invited: on the list, not seen yet.
    matched: "Signed in",
    never: "Invited",
    // COPY: needs approval (TF1 round 2)
    removeConfirm: (who: string) => `Remove ${who}? They can't chat any more.`,
    removeYes: "Remove",
    removeCancel: "Cancel",
    remove: (who: string) => `Remove ${who}`,
    removeFailed: "Couldn't remove them. Try again.",
    loadFailed: "Couldn't load the list. Refresh to try again.",
  },
} as const;
