export enum ChatbotStatus {
  /** Being set up. Connectors bound to it do not reply yet. */
  DRAFT = 'draft',
  LIVE = 'live',
  /** Switched off by an admin. Messages are recorded and not answered. */
  PAUSED = 'paused',
}

/** Who may chat with a bot. */
export enum ChatbotAccessMode {
  /** Anyone who messages a connector bound to the bot. */
  ANYONE = 'anyone',
  /** Anyone the channel can match to an Ally user. */
  RECOGNISED = 'recognised',
  /** Only the people, organisations and identifiers in `chatbot_audience`. */
  LISTED = 'listed',
}

/** What a bot may answer from. */
export enum ChatbotAnswerMode {
  /** Only its documents; anything they do not cover is declined. */
  DOCUMENTS_ONLY = 'documents_only',
  /** Its documents first, general knowledge when they do not cover the question. */
  DOCUMENTS_AND_GENERAL = 'documents_and_general',
}

/** Where a bot's documents come from. */
export enum ChatbotKnowledgeSource {
  /** The documents picked for this bot from the library. */
  SELECTED = 'selected',
  /**
   * The asker's own organisation's documents plus the shared ones — the original per-organisation
   * behaviour, kept for the platform number. Needs the asker to be recognised.
   */
  ORGANISATION = 'organisation',
}

/**
 * Dashboard access to one bot (Stage 1b: roles are a SET, `chatbot_members.roles`). What each role
 * allows is its capabilities (`ROLE_CAPABILITIES` in access/chatbot-roles.ts), not a ladder.
 *
 * The old single `chatbot_members.role` column is still written (dual write) with the highest
 * role of the set on the old ladder (owner > editor > viewer); a responder-only member is written
 * as `viewer` there, so an instance still running the old code never gives them more than viewing.
 */
export enum ChatbotMemberRole {
  /** See it, its conversations and usage, and test it. */
  VIEWER = 'viewer',
  /** Also change its persona, knowledge, replies, settings and who can chat. */
  EDITOR = 'editor',
  /** Also manage its members and connectors. */
  OWNER = 'owner',
  /**
   * Take over its conversations, reply and hand back (after accepting the responder agreement).
   * Never edit rights. Not on the old ladder: stored as `viewer` in the old `role` column.
   */
  RESPONDER = 'responder',
}

/**
 * The OLD ladder, kept for the `role` column and for `assert(min)` callers. A responder ranks with
 * a viewer here; what a responder may do beyond viewing is the `respond` capability.
 */
export const CHATBOT_ROLE_RANK: Record<ChatbotMemberRole, number> = {
  [ChatbotMemberRole.VIEWER]: 1,
  [ChatbotMemberRole.RESPONDER]: 1,
  [ChatbotMemberRole.EDITOR]: 2,
  [ChatbotMemberRole.OWNER]: 3,
};

/** What a member may do on one bot. Routes and services check these, never a role name. */
export enum ChatbotCapability {
  /** Read it: settings, conversations, usage; test it. */
  VIEW = 'view',
  /** Take over conversations, reply and hand back. */
  RESPOND = 'respond',
  /** Change what it says and knows: persona, knowledge, replies, settings, who can chat. */
  BUILD = 'build',
  /** Members, invites, ownership, connectors, archive. */
  MANAGE_PEOPLE = 'manage_people',
}

/** One "who can chat" entry. */
export enum ChatbotAudienceKind {
  /** An Ally user, by id. Works on any channel that can match a sender to a user. */
  USER = 'user',
  /** Every user of an organisation, by tenant id. */
  ORGANISATION = 'organisation',
  /** A phone number, compared on its last digits like the rest of the WhatsApp matching. */
  PHONE = 'phone',
  /** An email address, for channels that identify people by email. */
  EMAIL = 'email',
}

/** Which engine produced a reply that came from the agent runtime, as stored on the message. */
export enum AgentRuntimeUsed {
  V2 = 'v2',
  /**
   * `/agent/run` failed before an answer existed. Since Q3-fast the person gets the fixed run-failed
   * reply, never v1. The stored value keeps its old name: `wa_messages` has a CHECK on it.
   */
  V2_FAILED = 'v2_fallback',
}
