/** The inbox's words (copy §23, chunk 11a). `inbox.test.ts` holds them to the deck. */
export const INBOX = {
  nav: "Inbox",
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
  },
  replyPlaceholder: "Write a reply",
  send: "Send",
  windowOpen: "You can reply on WhatsApp until {time}.",
  windowClosed:
    "WhatsApp only lets you reply within 24 hours of their last message. You can reply again when they next write.",
  empty: "No conversations yet. They'll appear here as people chat.",
  nobodyWaiting: "Nobody is waiting for a person.",
  soundOn: "Sound on",
  soundOff: "Sound off",
  turnOnNotifications: "Turn on notifications",
  notifyNeedsPerson: "{business}: someone needs a person",
  notifySafety: "{business}: a safety message",
} as const;

export const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
