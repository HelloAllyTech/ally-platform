/** Where a conversation happens. A contact is recognised on each channel by one identity. */
export enum ConversationChannel {
  WHATSAPP = 'whatsapp',
  /** The bot page and, later, the website widget. */
  WEB = 'web',
  EMAIL = 'email',
}

/**
 * A thread's state. Nothing closes a thread yet: the idle window is computed from
 * `last_message_at` when the next message arrives, as on WhatsApp today.
 */
export enum ConversationStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

/** Who a message is from, as the engine's history names it. */
export enum ConversationMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}
