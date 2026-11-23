import { ChatbotStatus } from "@types";
import type { Chatbot } from "@types";

/**
 * A blank, untouched draft: nothing in it yet, so it is left out of the grid and the counts
 * (stage 2). Reads an explicit `blank` flag once the API sends one; until then a draft with a
 * setup session and no content of any kind counts as blank.
 */
export const isBlankDraft = (bot: Chatbot): boolean => {
  if (bot.blank !== undefined) return bot.blank;
  if (bot.status !== ChatbotStatus.DRAFT || !bot.setupDraftId) return false;
  const content =
    (bot.documentCount ?? 0) > 0 ||
    (bot.readyDocumentCount ?? 0) > 0 ||
    (bot.stats?.messages ?? 0) > 0 ||
    (bot.connectors?.length ?? 0) > 0 ||
    Boolean(bot.description) ||
    Boolean(bot.lastTestedAt);
  return !content;
};
