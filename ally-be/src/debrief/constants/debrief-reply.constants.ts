/**
 * What a learner sees when an Ask Ally reply failed a code check and was
 * replaced. A plain constants module, not the reply service: the metrics
 * service counts replaced replies by this text, and importing it from the
 * service closed an import cycle that left DebriefAgentService undefined at
 * boot.
 */
export const CHECK_FALLBACK =
  "I'd rather not answer that the way I first wrote it. Could you ask me " +
  'about one card, or tell me more about what you meant?';
