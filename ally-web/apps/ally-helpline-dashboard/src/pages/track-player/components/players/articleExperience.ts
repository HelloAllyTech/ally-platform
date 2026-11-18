import { ArticleExperience, StartArticleItemPayload } from "@types";

/** Missing or unknown (an older server) reads as the classic layout. */
export const articleExperience = (
  payload: Pick<StartArticleItemPayload, "experience">,
): ArticleExperience =>
  payload.experience === "MAGAZINE" || payload.experience === "CARDS"
    ? payload.experience
    : "CLASSIC";

/**
 * Whether the article plays as cards. The cards carry their own back/next
 * and their own way on at the end, so the course's bottom nav stands down.
 */
export const isCardsArticle = (payload: Pick<StartArticleItemPayload, "experience">): boolean =>
  articleExperience(payload) === "CARDS";

/** The takeaways worth showing: trimmed, blanks dropped. */
export const articleTakeaways = (payload: Pick<StartArticleItemPayload, "takeaways">): string[] =>
  (payload.takeaways ?? []).map(line => line.trim()).filter(line => line.length > 0);

/** Average adult silent-reading pace the estimate assumes. */
const WORDS_PER_MINUTE = 200;

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Minutes to read the article: the body's words plus the takeaways', at 200
 * a minute, rounded up and never under one. Text is gathered node by node so
 * adjacent blocks (`<p>a</p><p>b</p>`) don't run together into one word.
 */
export function articleReadingMinutes(html: string, takeaways: string[] = []): number {
  let words = takeaways.reduce((sum, line) => sum + countWords(line), 0);
  if (html) {
    const body = new DOMParser().parseFromString(html, "text/html").body;
    const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      words += countWords(node.textContent ?? "");
    }
  }
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
