/**
 * Assistants admin → Defaults & library → Templates. New wording only, for Ally staff.
 * // COPY: needs approval
 */
export const TEMPLATES_ADMIN_COPY = {
  intro:
    "The use-case templates owners start from, in setup and under Tools. Edit a built-in, copy one, or build a new one. Nothing reaches owners until you publish, and publishing never changes an assistant that was already set up from a template.",
  loading: "Loading templates…",
  loadFailed: "The templates didn't load. Try again.",
  tryAgain: "Try again",
  newTemplate: "New template",
  columns: {
    template: "Template",
    group: "For",
    status: "Status",
    used: "Set up from it",
    updated: "Changed",
  },
  groups: { organisations: "Organisations", businesses: "Businesses" } as Record<string, string>,
  status: {
    built_in: "Built in",
    overridden: (v: number) => `Built in, edited · live v${v}`,
    published: (v: number) => `Live · v${v}`,
    unpublished: "Not live",
  },
  draft: (v: number) => `Draft v${v} open`,
  assistants: (n: number) => (n === 1 ? "1 assistant" : `${n} assistants`),
  none: "None yet",
  open: "Open",
  empty: "No templates yet.",

  create: {
    title: "New template",
    startFrom: "Start from",
    blank: "Nothing (blank)",
    copyOf: (name: string) => `A copy of ${name}`,
    name: "Name",
    nameHint: "What owners see on the card, for example “Dental clinic”.",
    key: "Key",
    keyHint:
      "Lowercase letters, numbers and underscores. It identifies the template and can't change later.",
    start: "Start the draft",
    cancel: "Cancel",
    failed: {
      template_key_invalid:
        "The key is lowercase letters, numbers and underscores, starting with a letter.",
      template_key_taken: "That key is already used by another template.",
      draft_exists: "That template already has an open draft.",
      default: "The draft couldn't be started. Try again.",
    } as Record<string, string>,
  },

  editor: {
    back: "All templates",
    builtIn: "Built in",
    custom: "Made by staff",
    live: (v: number) => `Live · v${v}`,
    notLive: "Not live",
    draftOpen: (v: number) => `Editing draft v${v}`,
    noDraftTitle: "You're looking at the live template",
    noDraftBody:
      "To change it, open a draft. Owners keep seeing the live version until you publish the draft.",
    noDraftBuiltIn:
      "This is the built-in version. Editing it makes a draft that, once published, replaces it for new setups. Taking that down brings the built-in back.",
    edit: "Edit this template",
    copy: "Make a copy",
    save: "Save draft",
    saving: "Saving…",
    saved: "Draft saved.",
    saveFailed: "The draft didn't save. Try again.",
    unsaved: "Unsaved changes",
    publish: "Publish",
    publishing: "Publishing…",
    publishConfirm: (name: string, installs: number) =>
      `Publish “${name}”? Owners see it in the catalogue at once.${
        installs
          ? ` ${installs} ${installs === 1 ? "assistant was" : "assistants were"} already set up from it and won't change.`
          : ""
      }`,
    published: "Published. Owners see it now.",
    publishBlocked: (n: number) =>
      n === 1
        ? "1 problem to fix before this can be published."
        : `${n} problems to fix before this can be published.`,
    publishFailed: "It didn't publish. Try again.",
    publishRefused: "It wasn't published. Fix the problems below first.",
    discard: "Discard draft",
    discardConfirm: "Throw this draft away? The live template is not affected.",
    unpublish: "Take down",
    unpublishConfirmBuiltIn:
      "Take down your edited version? New setups go back to the built-in one. Assistants already set up don't change.",
    unpublishConfirmCustom:
      "Take this template down? It leaves the catalogue. Assistants already set up from it keep working.",
    unpublished: "Taken down.",
    ready: "No problems. This can be published.",
    warnings: (n: number) => (n === 1 ? "1 note" : `${n} notes`),
    problems: (n: number) => (n === 1 ? "1 problem" : `${n} problems`),
    tabs: {
      basics: "Basics",
      lists: "Lists",
      setup: "Setup questions",
      checkups: "Checkup questions",
      history: "History",
    },
  },

  basics: {
    key: "Key",
    group: "Shown under",
    groupHint: "Organisation templates come first in the picker.",
    name: "Name",
    oneLiner: "One-liner",
    oneLinerHint: "One sentence on the card.",
    audience: "Who it's for",
    icon: "Icon",
    iconHint: "An emoji. Organisation templates with a drawn picture keep it; others show this.",
    purpose: "What the assistant is for",
    pack: "Safety pack",
    packHint:
      "The least safety this template asks for. A setup only ever raises an assistant's pack, never lowers it.",
    packNone: "None",
    handOver: "Offer to hand over to a person",
    handOverHint:
      "Turns hand-over on for assistants set up from this template. It is never turned off.",
    memory: "Remember people between chats",
    memoryNotice: "What people are told the first time",
    memoryNoticeHint:
      "Shown instead of a yes/no question. Leave empty to ask. Adults only; for young people it should still ask.",
    organisationOnly: "Organisation members only",
    organisationOnlyHint: "A new assistant starts open only to the organisation's members.",
    instructions: "Instructions",
    instructionsHint:
      "Added to the assistant's extra instructions. {name} stands for the organisation's name and must appear. Never word these so the assistant skips the person's “yes” before an add, change or cancel.",
    suggestedFor: "Suggested for these industries",
    suggestedForHint:
      "Setup's industry names, separated by commas. The first match is shown first.",
  },

  lists: {
    intro:
      "The lists this template adds, and what the assistant may do with each. Lists the assistant already has are never changed. Every add, change or cancel still needs the person's “yes”.",
    add: "Add a list",
    choose: "Choose a list…",
    remove: "Remove",
    up: "Move up",
    down: "Move down",
    find: "Look up",
    create: "Add",
    update: "Change",
    doIt: "Do it",
    never: "Never",
    abilityHint:
      "“Do it” lets the assistant offer the action. It still asks the person to confirm before saving.",
    noWrite: "The assistant can't fill in anything on this list, so it can only look things up.",
    line: "How should your assistant use this list?",
    lineHint: "What the assistant is told about this list. 21 to 300 characters.",
    count: (n: number, max: number) => `${n}/${max}`,
    onlyIf: "Add it",
    always: "Always",
    onlyIfYes: (ask: string) => `Only if the owner says yes to “${ask}”`,
    onlyIfHint: "A list that depends on a yes/no setup question.",
    examples: (n: number) => (n === 1 ? "1 example entry kept" : `${n} example entries kept`),
    empty: "No lists. The assistant answers from documents alone.",
    pointsAt: (name: string) => `Points at ${name}, which must come first.`,
  },

  setup: {
    intro:
      "The few questions the owner answers once. Each can be skipped. Where an answer goes decides what it fills in.",
    add: "Add a question",
    remove: "Remove",
    ask: "Question",
    key: "Key",
    keyHint: "Checkup questions refer to the answer as {q:key}.",
    kind: "Answered as",
    kinds: {
      text: "Short text",
      long_text: "Long text",
      yes_no: "Yes or no",
      choices: "Pick from choices",
    },
    choices: "Choices",
    choicesHint: "One per line.",
    hint: "Help text",
    fills: "Where the answer goes",
    addFill: "Add a destination",
    fillTypes: {
      fact: "A line the assistant answers from",
      helpline: "The helpline number crisis replies give",
      entries: "Entries on a list, one per line",
      field: "The same value on every entry of a list",
      options: "The choices of a list's select",
      pack: "A yes asks for a safety pack",
      languages: "The languages it replies in",
      channel: "Where people message",
      list: "A yes adds a list",
    } as Record<string, string>,
    list: "List",
    field: "Detail",
    columns: "Details a line fills in, in order",
    columnsHint:
      "Separate with commas, for example name, price. A line is split at “ - ” or a colon.",
    available: (keys: string) => `Available: ${keys}`,
    pack: "Pack",
    empty: "No questions yet.",
  },

  checkups: {
    intro:
      "Starter questions added to the assistant's Checkup. {q:key} is a setup answer. A question that can't be filled in for an owner who skipped it is left out.",
    add: "Add a question",
    remove: "Remove",
    id: "Id",
    send: "What a person asks",
    expect: "A good reply",
    expects: {
      answer: "Answers it",
      decline: "Declines politely",
      clarify: "Asks for a detail first",
      crisis_only: "Gives crisis help only",
    },
    facts: "It must include",
    factsHint: "One per line. “A || B” reads B when A can't be filled in.",
    mustNot: "It must not say",
    alsoOk: "Also fine",
    hardFail: "Failing this blocks going live",
    needs: "Only when this list is added",
    anyList: "Always",
    empty: "No questions yet.",
  },

  history: {
    intro: "Every version of this template. A published version never changes.",
    version: (v: number) => `Version ${v}`,
    status: { draft: "Draft", published: "Live", retired: "Replaced" } as Record<string, string>,
    published: (d: string) => `Published ${d}`,
    created: (d: string) => `Started ${d}`,
    restore: "Open as a new draft",
    restoreConfirm: (v: number) => `Copy version ${v} into a new draft?`,
    restoreFailed: "That couldn't be restored.",
    needsNoDraft: "Discard or publish the open draft first.",
    none: "No versions yet. The built-in is in code.",
    builtIn: "Built-in version, in code",
  },
} as const;
