/**
 * Stage 3, the Create and Build screen. Kept apart from `COPY` (which `copy.test.ts` holds to the
 * product copy deck) and from `SPLIT_COPY` (the test pane's). None of this is in the deck yet.
 */
// COPY: needs approval (every string in this file)
export const BUILD_COPY = {
  title: "New chatbot",
  loading: "Getting your chatbot ready…",
  loadFailed: "We couldn't open this chatbot. Try again.",
  retry: "Try again",
  tooManyBlanks: "You have three new chatbots that are still empty. Finish or remove one first.",
  start: {
    heading: "How would you like to start?",
    template: "Start from template",
    templateHint: "A ready chatbot for a common use, with its knowledge included.",
    scratch: "Start from scratch",
    scratchHint: "Build it from your website, your documents or a short interview.",
    website: "From your website",
    websiteHint: "We read your pages and learn from them.",
    documents: "From your documents",
    documentsHint: "PDF or Word files, up to 10 at a time.",
    interview: "Answer a few questions",
    interviewHint: "Copilot asks, you answer.",
    back: "Back",
    addressLabel: "Your website address",
    addressPlaceholder: "yourorganisation.org",
    read: "Read my website",
    chooseFiles: "Choose files",
    upload: "Add these files",
    removeFile: "Remove {name}",
    fileLimits: "PDF or Word files, up to 10 at a time, 20 MB each.",
    starterNote:
      "Your test chatbot is on the right. Ask it something: it will answer once it knows a little.",
  },
  modes: {
    label: "How to build",
    copilot: "Copilot",
    copilotHint: "Build by talking",
    form: "Form",
    formHint: "Edit each setting directly",
  },
  templates: {
    heading: "Start from template",
    loading: "Loading templates…",
    failed: "We couldn't load the templates.",
    choose: "Use this template",
    back: "All templates",
    apply: "Set it up",
    applying: "Setting it up…",
    required: "Fill in your organisation's name.",
    yes: "Yes",
    no: "No",
    documents: "{n} documents included",
    applied: "Set up from the {name} template.",
    indexing: "Set up from the {name} template. {n} sources are still being read.",
    indexingOne: "Set up from the {name} template. 1 source is still being read.",
    notBlank: "Templates can only be used on a new, empty chatbot.",
    failedApply: "That didn't work. Nothing was changed. Try again.",
    fromTemplate: "From template",
  },
  form: {
    label: "Settings",
    sections: {
      sources: "Sources",
      identity: "Identity",
      tone: "Tone",
      instructions: "Instructions",
      languages: "Languages",
      questions: "Suggested questions",
      decline: "When it doesn't know",
      goLive: "Go live",
      access: "Who may chat",
    },
    name: "Chatbot name",
    nameHint: "Shown in your list of chatbots and on its page.",
    assistantName: "Name it uses in chat",
    greeting: "Greeting",
    greetingHint: "The first thing people see.",
    tone: "Tone",
    tones: { warm: "Warm", friendly: "Friendly", professional: "Professional", formal: "Formal" },
    instructions: "Instructions",
    instructionsHint:
      "How it should answer. Ally's safety rules always come first and can't be changed here.",
    languages: "Languages it replies in",
    languageNames: {
      en: "English",
      hi: "Hindi",
      mr: "Marathi",
      ta: "Tamil",
      kn: "Kannada",
      te: "Telugu",
      bn: "Bengali",
    } as Record<string, string>,
    oneLanguage: "Keep at least one language.",
    questions: "Suggested questions",
    questionsHint: "One per line. People can tap these to start.",
    decline: "What it says when it doesn't know",
    declineHint: "Say where people can get help instead.",
    pagesRead: "{n} pages read",
    sourcesEmpty: "No sources yet. Add your website or a document.",
    addressLabel: "Add a website",
    addAddress: "Read it",
    addFiles: "Add documents",
    fileStatus: {
      indexed: "Ready",
      pending: "Reading…",
      processing: "Reading…",
      failed: "Couldn't read",
      staged: "Waits for Apply",
    } as Record<string, string>,
  },
  field: {
    saving: "Saving…",
    saved: "Saved",
    savedLive: "In your test chatbot. Customers get it when you apply.",
    notApplied: "Not applied",
    stale: "This changed somewhere else while you were typing. Your text is kept here.",
    reload: "Use theirs",
    overwrite: "Keep mine",
    failed: "Not saved. Check your connection and try again.",
    retry: "Try again",
    refused: "This wasn't accepted.",
    credits: "Needs AI credits to check this. Contact Ally to add credits.",
    remove: "Remove",
  },
  pending: {
    one: "1 change waits for Apply. Your test chatbot already uses it; customers don't yet.",
    many: "{n} changes wait for Apply. Your test chatbot already uses them; customers don't yet.",
    apply: "Apply",
    applying: "Checking and applying…",
    applied: "Applied. Customers get these changes now.",
    elsewhere: "Also changed elsewhere",
    safetyConflict: "Not applied: {reason}",
    unavailable: "We couldn't check your changes right now. Nothing was applied.",
    retry: "Try again",
    creditsSome:
      "Some changes need AI credits to check, so they were not applied. Contact Ally to add credits.",
    notLive: "This chatbot isn't live yet, so your changes already apply as you make them.",
    failed: "That didn't work. Nothing was applied. Try again.",
    sources: "New sources",
  },
  credits: {
    title: "This needs AI credits",
    body: "Testing, Copilot and new sources use AI. Contact Ally to add credits. You can still edit the name and greeting.",
    field: "Needs AI credits. Contact Ally to add credits.",
  },
  copilot: {
    label: "Copilot",
    inputLabel: "Message Copilot",
    placeholder: "Paste your website, attach files, or tell me what to change",
    send: "Send",
    attach: "Attach files",
    thinking: "Working on it…",
    hello:
      "Hi! I'll help you build this chatbot. Paste your website, attach documents, or tell me about your organisation.",
    interviewHello: "Let's build it together. I'll ask a few questions.",
    proposalHeading: "Here's the change",
    apply: "Apply",
    discard: "Discard",
    applied: "Done. The form and your test chatbot use it now.",
    appliedLive: "Done. Your test chatbot uses it now; customers get it when you apply.",
    discarded: "Left as it was.",
    refused: "I can't make that change.",
    nothing: "I couldn't find a change in that. Try saying it another way.",
    stale: "That changed while we were talking. Ask again and I'll start from what it says now.",
    failed: "That didn't work this time. Nothing was changed.",
    reading: "Reading {address}…",
    queued: "I'll read {address} after the site I'm reading now.",
    uploaded: "Added {n} documents. Reading them now.",
    uploadedOne: "Added {title}. Reading it now.",
    uploadFailed: "I couldn't add those files. Try again.",
    pendingEdit:
      "You're editing {field} in the form and haven't finished. Replace what you typed with this change?",
    replace: "Replace it",
    keepMine: "Keep mine",
    saved: "Got it. I've put that in {field}.",
    skip: "Skip",
    ideas: "Ideas",
    empty: "(empty)",
    you: "You",
    copilot: "Copilot",
  },
  interview: [
    { field: "name", ask: "What's your organisation called?" },
    { field: "introduction", ask: "How should the chatbot greet people? One or two sentences." },
    {
      field: "ownerNotes",
      ask: "What should it help people with? Tell me what you do, where and when.",
    },
    { field: "declineText", ask: "When it doesn't know something, where should it send people?" },
  ] as const,
  crawlFailure: {
    crawl_daily_limit:
      "You've read as many websites as you can today. Try again tomorrow, or add documents instead.",
    crawl_unreachable:
      "We couldn't reach that website. Check the address is right and the site is online.",
    crawl_needs_javascript:
      "That website only shows its pages after a script runs, so we couldn't read them. Add documents instead.",
    crawl_turned_away:
      "That website turned us away. Add documents with the same information instead.",
    crawl_blocked: "That website asks robots not to read it, so we didn't.",
    crawl_little_found:
      "We found very little to learn on that website. Add documents with more detail.",
    crawl_failed: "Reading that website didn't work. Try again, or add documents instead.",
    crawl_queue_full: "A few websites are already waiting. Try again when one has been read.",
    invalid_website: "That doesn't look like a website address.",
  } as Record<string, string>,
  suggestions: {
    heading: "Ideas to make it better",
    greeting: "Add a greeting",
    instructions: "Say how it should answer",
    sources: "Add your website or documents",
    questions: "Add a few suggested questions",
    contact: "Say where to get help when it doesn't know",
    tone: "Choose a tone",
  },
  goLive: {
    placeholder: "Go-live checks arrive in a later release.",
    marker: "Coming soon",
    checklist: "Before going live",
    publish: "Go live",
    publishing: "Going live…",
    anyway: "Go live anyway",
    live: "Live. Edits now wait for Apply before customers get them.",
    link: "Open its page",
    failed: "That didn't work. Try again.",
    ready: "Ready to go live.",
    notEnforced: "These checks are shown but not required yet.",
    languages: "Crisis check by language",
    languageStatus: {
      pass: "Passed",
      off: "Failed, turned off for customers",
      unchecked: "Not checked yet",
      no_suite: "No crisis check for this language yet",
    } as Record<string, string>,
    runCrisis: "Run the crisis check",
    runningCrisis: "Checking every language…",
    crisisFailed: "The crisis check didn't run. Try again.",
    terms: "Safety terms",
    readTerms: "Read the safety terms",
    accept: "I accept the safety terms",
    accepted: "Accepted",
    termsOwnerOnly: "Only an author can accept the safety terms.",
    refused: "This can't go live yet. Finish the checklist first.",
  },
  accessPlaceholder: "Save the chatbot first, then choose who may chat.",
  archived: "This chatbot is archived, so it can't be tested.",
  checkup: {
    crisisTitle: "Crisis check",
    crisisBody: "Sends a message from someone at risk and checks it gets the crisis reply.",
    crisisRun: "Run the crisis check",
    crisisRunning: "Checking…",
    crisisOk: "It gave the crisis reply.",
    crisisBad: "It didn't give the crisis reply. Look at the safety settings before going live.",
    crisisFailed: "The check didn't run. Try again.",
    likelyTitle: "Ten likely questions",
    likelyBody: "Asks ten questions people are likely to ask and flags replies worth a look.",
    advanced: "Advanced: saved tests",
    viewerNote: "Only editors can run checks.",
  },
  starter: "Starter reply: no AI used.",
  workingCopy: "Test only: uses your changes that aren't applied yet. Customers don't see this.",
} as const;

/** Stage 6: sources paused at $0. */
export const PAUSED_COPY = {
  // COPY: needs approval
  site: "Paused: out of credits. Reading this website will resume after Ally adds credits.",
  // COPY: needs approval
  document: "Paused: out of credits. It will be read after Ally adds credits.",
  // COPY: needs approval
  contact: "Contact Ally to add credits.",
} as const;

/** Go live and the access list (D4): who may chat comes only from "Who may chat". */
export const GO_LIVE_ACCESS_COPY = {
  // COPY: needs approval
  nobodyYet: "Nobody can chat yet: add people under Who may chat.",
} as const;

/**
 * Why a source is paused, as ally-be names it (`CreditPauseKind`): out of credits, usage tracking
 * being off (resumes by itself; never "contact Ally for credits"), no billing account, or credits
 * that could not be checked.
 */
export type PausedKind = "out_of_credits" | "feed_off" | "no_payer" | "ledger_unavailable";

/** The text per reason (PAUSED_COPY stays the out-of-credits wording). */
export const PAUSED_REASON_COPY: Record<
  PausedKind,
  { site: string; document: string; note: string | null }
> = {
  out_of_credits: {
    site: PAUSED_COPY.site,
    document: PAUSED_COPY.document,
    note: PAUSED_COPY.contact,
  },
  feed_off: {
    // COPY: needs approval
    site: "Paused: usage tracking is temporarily unavailable. Reading this website will resume automatically.",
    // COPY: needs approval
    document: "Paused: usage tracking is temporarily unavailable. It will be read automatically.",
    // COPY: needs approval
    note: "Usage tracking is temporarily unavailable. Paused sources resume automatically; nothing to do.",
  },
  no_payer: {
    // COPY: needs approval
    site: "Paused: this chatbot has no billing account yet. Reading this website will resume once it has one.",
    // COPY: needs approval
    document: "Paused: this chatbot has no billing account yet. It will be read once it has one.",
    // COPY: needs approval
    note: "This chatbot has no billing account yet. Contact Ally to set one up.",
  },
  ledger_unavailable: {
    // COPY: needs approval
    site: "Paused: credits could not be checked just now. Reading this website will resume automatically.",
    // COPY: needs approval
    document: "Paused: credits could not be checked just now. It will be read automatically.",
    note: null,
  },
};

const PAUSED_PATTERNS: [RegExp, PausedKind][] = [
  [/^paused: out of credits/i, "out_of_credits"],
  [/^paused: usage tracking/i, "feed_off"],
  [/^paused: this chatbot has no billing account/i, "no_payer"],
  [/^paused: credits could not be checked/i, "ledger_unavailable"],
];

/** The reason a document's status message (set by ally-be while indexing waits) names, or null. */
export const pausedKindOf = (message: string | null | undefined): PausedKind | null =>
  PAUSED_PATTERNS.find(([pattern]) => pattern.test(message ?? ""))?.[1] ?? null;

/** The document status message the backend sets while indexing waits (any credits reason). */
export const isPausedMessage = (message: string | null | undefined): boolean =>
  pausedKindOf(message) !== null;
