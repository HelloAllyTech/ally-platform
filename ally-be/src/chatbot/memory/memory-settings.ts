import type { Chatbot } from '../entity/chatbot.entity';

export interface MemorySettings {
  on: boolean;
  /** The owner's own lines; the pack's defaults are added by `neverStoreList`. */
  neverStore: string[];
  /** TF1 B1: the notice a template set (adults are told, not asked); null to ask YES/NO. */
  notice: string | null;
}

/** The bot's memory settings, from its own stored override. Off unless switched on. */
export function memorySettingsOf(
  chatbot: Pick<Chatbot, 'settings'>,
): MemorySettings {
  const stored = chatbot.settings?.memory;
  return {
    on: stored?.on === true,
    neverStore: Array.isArray(stored?.neverStore)
      ? stored.neverStore.filter((n) => typeof n === 'string')
      : [],
    notice:
      typeof stored?.notice === 'string' && stored.notice.trim()
        ? stored.notice.trim()
        : null,
  };
}
