import { en, type BotPageCopy } from "./en";
import { hi } from "./hi";

import type { BotPageLanguage } from "../types";

export type { BotPageCopy };

/** The page's language setting, or the visitor's browser when the owner chose "auto". */
export function pickCopy(language: BotPageLanguage, browser = navigator.language): BotPageCopy {
  if (language === "hi") return hi;
  if (language === "en") return en;
  return browser?.toLowerCase().startsWith("hi") ? hi : en;
}

/** `fill("Question {n} of {total}", {n: 1, total: 3})`. */
export const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
