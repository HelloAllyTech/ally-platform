/** Whether a bot's page answers at its link. */
export enum BotPageStatus {
  OFF = 'off',
  ON = 'on',
}

/** Who may open a bot page. Separate from the bot's own `accessMode`, which covers every channel. */
export enum BotPageAccess {
  /** Anyone with the link. Only while the platform's `botPagePublicAllowed` is on. */
  PUBLIC = 'public',
  /** Active users of the organisations on the page's list, proved by an email code. */
  ORGANISATION = 'organisation',
  /** The email addresses on the page's list, proved by an email code. */
  INVITE = 'invite',
}

/** One entry on a page's access list. */
export enum BotPageAccessKind {
  /** A lower-cased email address. */
  EMAIL = 'email',
  /** An organisation, by tenant id. */
  ORGANISATION = 'organisation',
}

/** A pre-chat question's input. */
export enum PrechatFieldType {
  TEXT = 'text',
  EMAIL = 'email',
  PHONE = 'phone',
  CHOICE = 'choice',
  DATE = 'date',
  CONSENT = 'consent',
}
