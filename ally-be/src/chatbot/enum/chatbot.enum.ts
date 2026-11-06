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

/** Dashboard access to one bot. Each role includes the ones before it. */
export enum ChatbotMemberRole {
  /** See it, its conversations and usage, and test it. */
  VIEWER = 'viewer',
  /** Also change its persona, knowledge, replies, settings and who can chat. */
  EDITOR = 'editor',
  /** Also manage its members and connectors. */
  OWNER = 'owner',
}

export const CHATBOT_ROLE_RANK: Record<ChatbotMemberRole, number> = {
  [ChatbotMemberRole.VIEWER]: 1,
  [ChatbotMemberRole.EDITOR]: 2,
  [ChatbotMemberRole.OWNER]: 3,
};

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

/**
 * Which engine answers a bot's questions (Agents v2). A platform kill switch,
 * `agentRuntimeAllowed` on the shared defaults, turns every bot back to v1 without a deploy.
 */
export enum ChatbotRuntime {
  /** ally-ai's `/knowledge-agent/answer`, as Stage 1 built it. */
  V1 = 'v1',
  /** v1 answers; the same request also goes to `/agent/run` afterwards, for comparison only. */
  SHADOW = 'shadow',
  /** ally-ai's `/agent/run` (LangGraph), falling back to v1 if it fails before answering. */
  V2 = 'v2',
}

/** Which engine produced a reply that came from the agent runtime, as stored on the message. */
export enum AgentRuntimeUsed {
  V2 = 'v2',
  /** `/agent/run` failed before an answer existed, so v1 answered instead. */
  V2_FALLBACK = 'v2_fallback',
}
