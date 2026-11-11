import { useEffect, useRef, useState } from "react";

import type { Chatbot, ChatbotAnswerMode, ChatbotModelChoice, ChatbotPersona } from "@types";

/**
 * Unsaved changes handed to Preview by "Preview these changes" on the Persona and Agent tabs. Each
 * tab edits its own part and carries the rest through from any stored draft, else as saved. The
 * draft stays until its edits are saved or thrown away, so coming back from Preview finds them
 * where they were left.
 */
export interface PreviewDraft {
  name: string;
  description: string;
  persona: ChatbotPersona;
  answerMode: ChatbotAnswerMode;
  model: ChatbotModelChoice | null;
}

const storageKey = (botId: string) => `chatbot-draft:${botId}`;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const store = (botId: string, draft: PreviewDraft): void => {
  try {
    sessionStorage.setItem(storageKey(botId), JSON.stringify(draft));
  } catch {
    // Storage refused: the test runs against the saved bot instead.
  }
};

/** Forget the draft, once it is saved or thrown away. */
const clearPreviewDraft = (botId: string): void => {
  try {
    sessionStorage.removeItem(storageKey(botId));
  } catch {
    // Nothing to clear.
  }
};

/** The bot as saved, in the draft's shape. */
const savedDraftOf = (bot: Chatbot): PreviewDraft => ({
  name: bot.name,
  description: bot.description ?? "",
  persona: { ...bot.persona },
  answerMode: bot.answerMode,
  model: bot.model,
});

/**
 * Leave the draft for Preview in session storage — or nothing, when it is just the saved bot. If
 * storage is refused, Preview tests the saved bot.
 */
const handOverToPreview = (bot: Chatbot, draft: PreviewDraft): void => {
  if (same(draft, savedDraftOf(bot))) {
    clearPreviewDraft(bot.id);
    return;
  }
  store(bot.id, draft);
};

/** The whole draft left for this bot, if there is one. */
const readStoredDraft = (botId: string): PreviewDraft | undefined => {
  try {
    const raw = sessionStorage.getItem(storageKey(botId));
    return raw ? (JSON.parse(raw) as PreviewDraft) : undefined;
  } catch {
    return undefined;
  }
};

/** Hand one tab's unsaved part to Preview, with the rest of any stored draft, else as saved. */
export const handOverPart = (bot: Chatbot, part: Partial<PreviewDraft>): void =>
  handOverToPreview(bot, { ...(readStoredDraft(bot.id) ?? savedDraftOf(bot)), ...part });

/**
 * After one tab saves its part: the stored draft takes the saved values for that part, and is
 * dropped once nothing in it differs from the saved bot. The other tab's unsaved part is kept.
 */
export const settlePreviewDraft = (bot: Chatbot, saved: Partial<PreviewDraft>): void => {
  const stored = readStoredDraft(bot.id);
  if (!stored) return;
  const next = { ...stored, ...saved };
  if (same(next, { ...savedDraftOf(bot), ...saved })) {
    clearPreviewDraft(bot.id);
  } else {
    store(bot.id, next);
  }
};

/**
 * One tab's part of the draft: it starts from the stored draft when there is one (edits handed to
 * Preview), else from the saved bot. It follows the saved bot as that changes, unless the tab holds
 * edits of its own — so a refetch never wipes what someone is typing. `pick` must be stable.
 */
export const useTabDraft = <T>(bot: Chatbot, pick: (draft: PreviewDraft) => T) => {
  const [draft, setDraft] = useState<T>(() => pick(readStoredDraft(bot.id) ?? savedDraftOf(bot)));
  const baseline = useRef<T>(pick(savedDraftOf(bot)));
  useEffect(() => {
    const previous = baseline.current;
    const next = pick(savedDraftOf(bot));
    baseline.current = next;
    setDraft(current => (same(current, previous) ? next : current));
  }, [bot, pick]);
  const dirty = !same(draft, pick(savedDraftOf(bot)));
  return { draft, setDraft, dirty };
};
