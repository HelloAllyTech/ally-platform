import type { ChatbotAnswerMode, ChatbotDraft, ChatbotModelChoice, ChatbotPersona } from "@types";

/**
 * Unsaved changes handed to Preview by "Preview these changes" on the Persona and Agent tabs. Each
 * tab edits part of it and carries the rest through as saved.
 */
export interface PreviewDraft {
  name: string;
  description: string;
  persona: ChatbotPersona;
  answerMode: ChatbotAnswerMode;
  model: ChatbotModelChoice | null;
}

const storageKey = (botId: string) => `chatbot-draft:${botId}`;

/** Leave the draft for Preview in session storage. If storage is refused, Preview tests the saved bot. */
export const handOverToPreview = (botId: string, draft: PreviewDraft): void => {
  try {
    sessionStorage.setItem(storageKey(botId), JSON.stringify(draft));
  } catch {
    // Storage refused: the test runs against the saved bot instead.
  }
};

/** The draft handed over to Preview, as the test request's `draft`; read once. */
export const takePreviewDraft = (botId: string): ChatbotDraft | undefined => {
  try {
    const raw = sessionStorage.getItem(storageKey(botId));
    if (!raw) return undefined;
    sessionStorage.removeItem(storageKey(botId));
    const draft = JSON.parse(raw) as PreviewDraft;
    return { persona: draft.persona, answerMode: draft.answerMode, model: draft.model };
  } catch {
    return undefined;
  }
};
