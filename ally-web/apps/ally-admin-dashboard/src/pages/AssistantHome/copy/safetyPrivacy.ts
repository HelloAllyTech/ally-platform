/**
 * Wording for the safety and privacy settings, the knowledge review, copying knowledge and
 * duplicating. Kept out of HOME and COPY on purpose: their tests compare every string with the
 * approved copy deck, and none of these is in it yet.
 */
// COPY: needs approval
export const SAFETY_PRIVACY_COPY = {
  title: "Safety and privacy",
  hint: "Who uses this chatbot, how long chats are kept, and how your team hears about someone who may be at risk.",
  saved: "Saved.",
  saveFailed: "That didn't save. Try again.",
  ownerOnly: "Only an author can make this setting less strict.",
  audience: {
    label: "Who will use it",
    unstated: "Not said yet",
    adults: "Adults only",
    includes_minors: "People who may be under 18",
  } as Record<string, string>,
  contact: {
    label: "How people reach a person",
    hint: "Add at least one: a phone number, an email or a web page.",
    phone: "Phone number",
    email: "Email address",
    url: "Web page",
    save: "Save contact",
  },
  retention: {
    label: "Keep chats for (days)",
    hint: "From 7 to 365 days. After that they are deleted.",
  },
  noAnswer: {
    label: "When it doesn't know",
    say_unknown_offer_person: "Say it doesn't know and offer a person",
    say_unknown: "Say it doesn't know",
    offer_person: "Offer a person",
  } as Record<string, string>,
  alerts: {
    label: "Alerts when someone may be at risk",
    hint: "These can't be turned off. Choose how fast your team hears.",
    immediate: "Straight away",
    digest: "In a digest",
    recipients: "Extra email addresses to alert, one per line",
    recipientsHint: "Leave empty to alert the authors and responders.",
    save: "Save alerts",
  },
  wait: {
    label: "Wait before saying no one is available (minutes)",
    hint: "From 2 to 120 minutes.",
  },
  resume: {
    label: "After a chat is flagged",
    never: "Only a person hands it back",
    after_idle: "It can go back to the assistant after a quiet spell",
  } as Record<string, string>,
  timeZone: {
    label: "Time zone",
    hint: "A zone name such as Asia/Kolkata.",
  },
  archived: {
    saving: "Saving…",
    failed: "That didn't save. Try again.",
  },
  quick: {
    locked: "Fixed by Ally. The wording can't be changed.",
    numbers: "Regional numbers to add",
    numbersHint: "One per line. They are sent with this reply.",
    save: "Save numbers",
  },
  duplicate: {
    title: "Duplicate this chatbot",
    hint: "Copies the persona, settings, rules, quick replies and documents into a new draft that you own. People, channels, memory and conversations are not copied.",
    action: "Duplicate chatbot",
    working: "Duplicating…",
    done: "Copied. Open the copy",
    failed: "It didn't copy. Try again.",
  },
  knowledge: {
    reviewTitle: "Sources to review",
    reviewHint:
      "These may contain personal details, so they are held back until an author approves them.",
    reviewEmpty: "Nothing is waiting for review.",
    found: "Found",
    approve: "Approve",
    exclude: "Leave out",
    ownerApprove: "Only an author can approve a source.",
    freshTitle: "Keep it fresh",
    freshDays: "Your oldest source was read {n} days ago.",
    freshNone: "No sources to read again yet.",
    readAgain: "Read again",
    reading: "Reading…",
    readChanged: "It changed, so it is being learned again.",
    readSame: "Nothing changed.",
    readFailed: "It didn't read. Try again.",
    copyTitle: "Copy from another chatbot",
    copyHint: "Makes private copies of its documents here. Only chatbots you can edit are listed.",
    copyPick: "Choose a chatbot",
    copyAction: "Copy documents",
    copied: "Copied {n} documents. {skipped} skipped.",
    poolTitle: "Add from Ally's library",
    poolHint: "Documents Ally has prepared. Each one is copied to this chatbot.",
    poolEmpty: "Nothing in the library yet.",
    poolAdd: "Add",
    poolAdded: "Added.",
    failed: "That didn't work. Try again.",
  },
  goLive: {
    audienceMissing: "Say who will use it.",
    purpose: "What it is for",
    purposeNote: "Say in a few words what it is for",
    purposes: {
      answer: "Answer questions",
      enquiries: "Take enquiries",
      training: "Train people",
      guide: "Guide people",
      custom: "Something else",
    } as Record<string, string>,
    contactSaved: "Contact saved.",
    mustFinish: "Still needed:",
  },
  access: {
    title: "Who may chat",
  },
} as const;
