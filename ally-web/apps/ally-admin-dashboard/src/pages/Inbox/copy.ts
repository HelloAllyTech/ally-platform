/** The inbox's words (copy §23, chunk 11a). `inbox.test.ts` holds them to the deck. */
export const INBOX = {
  nav: "Inbox",
  allAssistants: "All assistants",
  back: "Back to chats",
  filters: {
    needs_person: "Needs a person",
    live: "Live now",
    all: "All",
  },
  channels: {
    all: "All channels",
    whatsapp: "WhatsApp",
    web: "Bot page",
    widget: "Website",
  },
  takeOver: "Take over",
  handBack: "Hand back to assistant",
  takenOver: "You're replying. Your assistant is paused in this chat.",
  someoneElse: "{name} is replying in this chat.",
  safety: "Safety",
  needsPerson: "Needs a person",
  assistant: "Your assistant",
  replying: "{name} is replying",
  reasons: {
    asked: "Asked for a person",
    declined_twice: "Couldn't help twice",
    // The assistant passed the chat on with its hand_over tool (chunk 3b).
    assistant: "Your assistant passed it on",
  },
  replyPlaceholder: "Write a reply",
  send: "Send",
  windowOpen: "You can reply on WhatsApp until {time}.",
  windowClosed:
    "WhatsApp only lets you reply within 24 hours of their last message. You can reply again when they next write.",
  empty: "No conversations yet. They'll appear here as people chat.",
  pickChat: "Pick a chat to read it.",
  nobodyWaiting: "Nobody is waiting for a person.",
  soundOn: "Sound on",
  soundOff: "Sound off",
  /** The sound toggle's name and tooltip (chunk 20d-2, deck §25). */
  soundTipOn: "Sound for new chats: on",
  soundTipOff: "Sound for new chats: off",
  today: "Today",
  yesterday: "Yesterday",
  addToCheckup: "Add to checkup",
  addedToCheckup: "Added to your checkup. It's asked in the next one.",
  helpful: "Helpful",
  notHelpful: "Not helpful",
  turnOnNotifications: "Turn on notifications",
  notifyNeedsPerson: "{business}: someone needs a person",
  notifySafety: "{business}: a safety message",
  /** What the assistant remembers about the person in a chat (chunk 8a, deck §28). */
  memory: {
    title: "What your assistant remembers about {name}",
    titleNoName: "What your assistant remembers about this person",
    sections: {
      open_items: "Still open",
      preferences: "Preferences",
      context: "Context",
    },
    from: "From their message on {date}",
    byTeam: "Changed by your team",
    empty: "Nothing yet. Notes appear here as they chat.",
    forget: "Forget",
    forgetLine: "Forget “{line}”",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    forgotten: "Forgotten.",
    invalid: "Write it in 1 to 200 characters.",
    neverStore: "That's on the list of things your assistant never remembers.",
    editFailed: "Couldn't change this. Try again.",
    forgetPerson: "Forget this person",
    confirmTitle: "Forget everything about {name}?",
    confirmTitleNoName: "Forget everything about this person?",
    confirmBody:
      "Your assistant forgets every note about them and the summaries of their chats. Their messages stay.",
    confirm: "Forget everything",
    keep: "Keep",
    forgotPerson: "Your assistant has forgotten them.",
    loadFailed: "We couldn't load what your assistant remembers.",
    retry: "Try again",
    intro:
      "It uses these in later chats, so {name} doesn't have to repeat themselves. You can change or forget any of it.",
    introNoName:
      "It uses these in later chats, so they don't have to repeat themselves. You can change or forget any of it.",
    about: "About them",
    name: "Name",
    noName: "Not given yet",
    beforeChat: "What they told the page before the chat",
    beforeChatHint: "Your assistant reads this in every chat.",
    notes: "Notes it keeps",
    sectionHints: {
      open_items: "Things they're waiting on. Marked done when sorted, or dropped after 30 days.",
      preferences: "How they like things. Used to suggest times and options.",
      context: "Useful background about them.",
    },
    saidHere: "Said on {date} in this chat",
    saidEarlier: "Said on {date} in an earlier chat",
    keptUntil: "Kept until {date}",
    keptForever: "Kept until forgotten",
    summary: "This chat so far",
    summaryHint:
      "Your assistant's own summary of the earlier messages, which it no longer reads word for word.",
    neverKeeps: "It never keeps:",
    // COPY: needs approval (TF1 round 2). Memory's switch is in Settings, where these links go.
    changeNever: "Change this in Settings",
    off: "Your assistant doesn't remember people between chats.",
    // COPY: needs approval (TF1 round 2)
    turnOn: "Turn it on in Settings",
  },
} as const;

export const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));

/** A chat's channel as the inbox names it: WhatsApp, Bot page, or Website (the widget, chunk 13). */
export const channelLabel = (chat: { channel: string; source?: "widget" | null }): string =>
  chat.source === "widget"
    ? INBOX.channels.widget
    : INBOX.channels[chat.channel === "web" ? "web" : "whatsapp"];
