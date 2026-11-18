import {
  ARTICLE_WORDS_PER_MINUTE,
  MAX_ARTICLE_COVER_ALT_LENGTH,
  MAX_ARTICLE_TAKEAWAY_LENGTH,
  MAX_ARTICLE_TAKEAWAYS,
} from "@constants";
import { ArticleContent, ArticleExperience } from "@types";

/**
 * The article's presentation — reading experience, cover photo and key
 * takeaways — kept apart from the body and its questions, which
 * `trackFormUtils` already owns. Pure functions only, shared by the editor,
 * the save path and publish validation so the three agree.
 */

/** The experience the learner gets; anything unset reads as Classic. */
export const articleExperienceOf = (article?: Pick<ArticleContent, "experience">) =>
  article?.experience ?? ArticleExperience.CLASSIC;

/**
 * Cards mode starts a new card at each top-level `<h2>`. Without one the
 * whole article is a single card, which is worth telling the author.
 */
export const articleHasCardBreaks = (html: string): boolean => /<h2[\s>]/i.test(html ?? "");

/** Takeaways as they are saved: trimmed, blanks dropped. */
export const cleanTakeaways = (takeaways?: string[] | null): string[] =>
  (takeaways ?? []).map(takeaway => (takeaway ?? "").trim()).filter(Boolean);

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** Words the reader reads: the body's text (tags stripped) plus the takeaways. */
export const countArticleWords = (html: string, takeaways?: string[] | null): number => {
  const bodyText = (html ?? "")
    // Each tag becomes a space so "<p>a</p><p>b</p>" is two words, not "ab".
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ");
  return (
    countWords(bodyText) +
    cleanTakeaways(takeaways).reduce((total, takeaway) => total + countWords(takeaway), 0)
  );
};

/** "Reading time: about N min" — never less than one minute. */
export const estimateReadingMinutes = (html: string, takeaways?: string[] | null): number =>
  Math.max(1, Math.ceil(countArticleWords(html, takeaways) / ARTICLE_WORDS_PER_MINUTE));

/**
 * The presentation fields as they are sent to the server. Each key is left
 * out when it holds nothing — Classic included — so an article that uses
 * none of this saves byte-for-byte as it did before these fields existed.
 */
export const serializeArticlePresentation = (
  article?: ArticleContent,
): Pick<ArticleContent, "experience" | "cover" | "takeaways"> => {
  const experience = article?.experience;
  const coverUrl = article?.cover?.url?.trim();
  const coverAlt = article?.cover?.alt?.trim();
  const takeaways = cleanTakeaways(article?.takeaways);
  return {
    ...(experience && experience !== ArticleExperience.CLASSIC ? { experience } : {}),
    ...(coverUrl ? { cover: { url: coverUrl, ...(coverAlt ? { alt: coverAlt } : {}) } } : {}),
    ...(takeaways.length > 0 ? { takeaways } : {}),
  };
};

/** Publish checks for the presentation fields; mirrors the server's own. */
export const validateArticlePresentation = (article?: ArticleContent): string[] => {
  const errors: string[] = [];
  const experience = article?.experience;
  if (experience != null && !Object.values(ArticleExperience).includes(experience)) {
    errors.push("Article: reading experience must be Classic, Magazine or Cards");
  }

  const cover = article?.cover;
  if (cover?.url && !cover.url.trim().startsWith("https://")) {
    errors.push("Article: the cover photo must be an uploaded image (https link)");
  }
  if ((cover?.alt ?? "").trim().length > MAX_ARTICLE_COVER_ALT_LENGTH) {
    errors.push(
      `Article: the cover photo description must be ${MAX_ARTICLE_COVER_ALT_LENGTH} characters or fewer`,
    );
  }

  // Blank rows are dropped on save, so only the ones with text count.
  const takeaways = article?.takeaways ?? [];
  if (cleanTakeaways(takeaways).length > MAX_ARTICLE_TAKEAWAYS) {
    errors.push(`Article: at most ${MAX_ARTICLE_TAKEAWAYS} key takeaways`);
  }
  takeaways.forEach((takeaway, index) => {
    if ((takeaway ?? "").trim().length > MAX_ARTICLE_TAKEAWAY_LENGTH) {
      errors.push(
        `Article takeaway ${index + 1}: keep it to ${MAX_ARTICLE_TAKEAWAY_LENGTH} characters`,
      );
    }
  });
  return errors;
};
