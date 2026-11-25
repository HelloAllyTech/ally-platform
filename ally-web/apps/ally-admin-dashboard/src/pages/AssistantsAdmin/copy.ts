/**
 * Ally admin → Assistants admin: Ally staff's one home for running the Assistants product.
 * New strings only, never inside `COPY`. Every line below is new wording. // COPY: needs approval
 */
export const ASSISTANTS_ADMIN_COPY = {
  title: "Assistants admin",
  subtitle:
    "Everything Ally staff run for the Assistants product, in one place: what builders have, what it costs, what keeps people safe, and how to launch and support it.",
  navLabel: "Sections",
  viewsLabel: "Views in this section",
  loadingAccess: "Checking your access…",
  noAccessTitle: "You don't have access to any part of Assistants admin",
  noAccessBody:
    "Each section needs its own grant. Ask a platform admin to give you the costs toggle, the safety-pack curator grant, or system access.",
  loadingSection: "Loading…",
  sections: {
    overview: {
      label: "Overview",
      purpose: "Start here. What needs you today, and a shortcut to every common task.",
    },
    credits: {
      label: "Builders & credits",
      purpose:
        "Every builder pays for building, testing and customer replies out of credits that only Ally staff grant.",
      tasks: [
        "Grant or adjust credits",
        "Move a chatbot's budget to another builder",
        "See each builder's balance, budgets and grant history",
        "Give every builder their starting credits",
      ],
    },
    pricing: {
      label: "Pricing & costs",
      purpose:
        "What the product costs Ally to run, and the prices and plans that sit on top of it.",
      views: {
        costs: {
          label: "Costs",
          hint: "What AI and WhatsApp spend came to, by day, by chatbot and by customer, with alerts and an export.",
        },
        models: {
          label: "Model prices",
          hint: "Every AI model with its price per million tokens. A model with no price is costed at a pessimistic fallback and raises an alert.",
        },
        whatsapp: {
          label: "WhatsApp rates",
          hint: "Meta's per-message rates by country and category, used to cost WhatsApp conversations.",
        },
        plans: {
          label: "Plans & seats",
          hint: "The plans and seat types on offer, extra seats per assistant, and renewals due in the next 7 days.",
        },
      },
    },
    safety: {
      label: "Safety",
      purpose:
        "Safety packs decide how every chatbot handles risk. A release goes live only after it passes the crisis check in every supported language.",
      tasks: [
        "Draft, test and release a pack",
        "Roll a pack back",
        "See which chatbots use which pack",
      ],
      note: {
        text: "The fixed crisis, STOP and HELP replies are reworded under",
        linkLabel: "Defaults & library → Quick replies",
      },
    },
    content: {
      label: "Defaults & library",
      purpose:
        "What every chatbot starts from, and the shared material they can draw on. Changing a default never overwrites what a builder has set themselves.",
      views: {
        settings: { label: "Starting settings" },
        replies: { label: "Quick replies" },
        library: {
          label: "Knowledge library",
          hint: "Shared documents any chatbot can draw on, including the curated pool.",
        },
        channels: {
          label: "Channels & numbers",
          hint: "Every WhatsApp number and which chatbot answers it.",
        },
      },
    },
    support: {
      label: "Support",
      purpose:
        "Find any builder's chatbot and open it read-only. Every search and every read is logged, and the owner can see who looked.",
      tasks: ["Search by chatbot name or owner", "Open a chatbot read-only"],
    },
    launch: {
      label: "Launch & data",
      purpose:
        "The few jobs that run outside this screen: kill switches, the launch order, and the data clean-ups that can't be undone.",
      views: {
        switches: {
          label: "Kill switches",
          hint: "Every feature can be turned off without a deploy. This is what each switch does and how to flip it.",
        },
        checklist: {
          label: "Launch checklist",
          hint: "The order to release and switch things on, with what to check at each step.",
        },
        data: {
          label: "Data clean-up",
          hint: "Retention, memory deletion and the unpublish backfill. Always dry-run first.",
        },
      },
    },
  },
  overview: {
    attentionTitle: "Needs your attention",
    attentionHint: "Live from the product. Each card opens the place to fix it.",
    allClear: "All clear",
    open: "Open",
    credits: {
      out: (n: number) =>
        n === 1 ? "1 builder is out of credits" : `${n} builders are out of credits`,
      low: (n: number) => (n === 1 ? "1 builder is running low" : `${n} builders are running low`),
      ok: "Every builder has credits",
      hint: "Out means a free balance of zero: they can't build or test. Low is under $5.",
    },
    models: {
      some: (n: number) => (n === 1 ? "1 model has no price" : `${n} models have no price`),
      none: "Every model in use is priced",
      hint: "Usage on an unpriced model is costed at a pessimistic fallback.",
    },
    costs: {
      some: (n: number) => (n === 1 ? "1 cost alert" : `${n} cost alerts`),
      none: "No cost alerts",
      hint: "Spend spikes and per-conversation alerts from the Costs view.",
    },
    safety: {
      hintOn: "Every chatbot uses its pack's current release.",
      off: "Safety pack releases are switched off",
      on: (n: number) =>
        n === 1 ? "1 safety pack on a release" : `${n} safety packs on a release`,
      hint: "When off, every chatbot uses the packs written in code.",
    },
    numbersTitle: "This month so far",
    spendMonth: "AI and WhatsApp spend this month",
    spendToday: "Spent today",
    builders: "Builders with an account",
    tasksTitle: "What do you want to do?",
    tasksHint: "Pick a job. It opens the right place.",
    loadFailed: "Couldn't load this card.",
  },
  tasks: [
    { id: "grant", label: "Give a builder more credits", section: "credits" },
    { id: "transfer", label: "Move a chatbot's budget to another builder", section: "credits" },
    { id: "price", label: "Add or fix a model's price", section: "pricing", view: "models" },
    {
      id: "spend",
      label: "See what the product cost this month",
      section: "pricing",
      view: "costs",
    },
    { id: "plans", label: "Change a plan or add seats", section: "pricing", view: "plans" },
    { id: "pack", label: "Release or roll back a safety pack", section: "safety" },
    {
      id: "defaults",
      label: "Change what new chatbots start with",
      section: "content",
      view: "settings",
    },
    { id: "reply", label: "Reword a fixed or locked reply", section: "content", view: "replies" },
    {
      id: "library",
      label: "Add to the shared knowledge library",
      section: "content",
      view: "library",
    },
    {
      id: "number",
      label: "Connect or move a WhatsApp number",
      section: "content",
      view: "channels",
    },
    { id: "look", label: "Look inside a builder's chatbot, read-only", section: "support" },
    {
      id: "switch",
      label: "Turn a feature off in an emergency",
      section: "launch",
      view: "switches",
    },
    { id: "launch", label: "Run the launch steps in order", section: "launch", view: "checklist" },
    {
      id: "retention",
      label: "Check or run the data retention sweep",
      section: "launch",
      view: "data",
    },
  ] as { id: string; label: string; section: string; view?: string }[],
} as const;
