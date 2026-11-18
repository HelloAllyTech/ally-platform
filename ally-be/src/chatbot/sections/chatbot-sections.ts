/**
 * The configurable parts of a chatbot, as a registry.
 *
 * Each section names the fields it owns and where they are stored, so the API can describe a bot's
 * configuration to the dashboard (`GET v1/chatbots/sections`) and the dashboard renders one form
 * per section from its own matching registry. Adding a configurable detail is one entry here and
 * one form component there; nothing else changes.
 *
 * `storage` says where the fields live:
 *  - `bot`      — columns on `chatbots` (persona, modes, model);
 *  - `settings` — the bot's overrides of the defaults, merged with the clamps in
 *                 ChatbotSettingsService.applyOverride;
 *  - `relation` — a list of its own (documents, audience, members, connectors).
 */
export interface ChatbotSectionDefinition {
  key: string;
  label: string;
  description: string;
  storage: 'bot' | 'settings' | 'relation';
  /** Field paths owned by the section. */
  fields: string[];
  /** The least dashboard role that may change it. */
  editRole: 'editor' | 'owner';
  /** Only platform admins may change it (it reaches beyond this bot). */
  platformOnly?: boolean;
}

export const CHATBOT_SECTIONS: ChatbotSectionDefinition[] = [
  {
    key: 'persona',
    label: 'Persona',
    description:
      'Who the bot is: its name, instructions, tone and the greeting a person gets first.',
    storage: 'bot',
    fields: [
      'name',
      'description',
      'persona.displayName',
      'persona.systemPrompt',
      'persona.tone',
      'persona.greeting',
      'persona.defaultLanguage',
    ],
    editRole: 'editor',
  },
  {
    key: 'answering',
    label: 'Answering',
    description:
      'What the bot answers from, which model writes the answers, and how strict retrieval is.',
    storage: 'bot',
    fields: [
      'answerMode',
      'model',
      'settings.maxAnswerChars',
      'settings.maxCitations',
      'settings.retrieval.minSimilarity',
      'settings.retrieval.declineSimilarity',
      'settings.retrieval.topK',
      'settings.retrieval.maxPassages',
    ],
    editRole: 'editor',
  },
  {
    key: 'knowledge',
    label: 'Knowledge',
    description: 'The library documents the bot answers from.',
    storage: 'relation',
    fields: ['knowledgeSource', 'documents'],
    editRole: 'editor',
  },
  {
    key: 'safety',
    label: 'Safety',
    description:
      'Crisis wording and helplines. The crisis checks can be made stricter here, never weaker.',
    storage: 'settings',
    fields: [
      'helplineNumbers',
      'crisisEscalationText',
      'crisisClassifierEnabled',
      'consentRequired',
      'disclaimerText',
    ],
    editRole: 'editor',
  },
  {
    key: 'messages',
    label: 'Messages',
    description:
      'What the bot says when it cannot answer, or cannot help this person.',
    storage: 'settings',
    fields: [
      'declineText',
      'fallbackText',
      'unrecognisedNumberText',
      'unsupportedMediaText',
      'rateLimitText',
    ],
    editRole: 'editor',
  },
  {
    key: 'limits',
    label: 'Limits',
    description:
      'How often one person can message, and when a conversation is considered over.',
    storage: 'settings',
    fields: [
      'rateLimit.perMinute',
      'rateLimit.perHour',
      'rateLimit.perDay',
      'conversationIdleMinutes',
    ],
    editRole: 'editor',
  },
  {
    key: 'access',
    label: 'Who can chat',
    description:
      'Anyone, any recognised Ally user, or only the people on the list.',
    storage: 'relation',
    fields: ['accessMode', 'audience'],
    editRole: 'editor',
  },
  {
    key: 'members',
    label: 'Team',
    description: 'Who can see, change and manage this bot in the dashboard.',
    storage: 'relation',
    fields: ['members'],
    editRole: 'owner',
  },
  {
    key: 'connectors',
    label: 'Connectors',
    description: 'Where people reach the bot — a WhatsApp number today.',
    storage: 'relation',
    fields: ['connectors'],
    editRole: 'owner',
  },
];
