import type { BotPageCopy } from "./copy";
import type { BlockedState, BotPageErrorCode, PublicBotPage } from "./types";

/** The server's refusal codes that mean "the fixed notification", not an error screen. */
export const BLOCKED_CODES: Partial<Record<BotPageErrorCode, BlockedState>> = {
  BOT_PAGE_OUT_OF_CREDITS: "OUT_OF_CREDITS",
  BOT_PAGE_NOT_ON_LIST: "REMOVED_FROM_LIST",
};

/** The chatbot's crisis information: its own numbers first when set, then the helpline link. */
export function crisisLine(copy: BotPageCopy, page?: PublicBotPage | null): string {
  const numbers = page?.crisis?.numbers?.trim();
  const url = page?.crisis?.helplineUrl?.trim() || copy.crisis.linkUrl;
  const call = numbers ? `${copy.crisis.numbers.replace("{numbers}", numbers)} ` : "";
  return `${call}${copy.blocked.crisisLead} ${url.replace(/^https?:\/\//, "")}`;
}

/**
 * The fixed notification for a blocked turn. The server's own text wins when it sends one;
 * otherwise the page words it from its fixed lines. No model call is behind either.
 */
export function blockedNotice(
  copy: BotPageCopy,
  state: BlockedState,
  page?: PublicBotPage | null,
  serverText?: string | null,
): string {
  const text = serverText?.trim();
  if (text) return text;
  return `${copy.blocked[state]} ${crisisLine(copy, page)}`;
}
