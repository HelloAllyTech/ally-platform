import DOMPurify from "dompurify";

import { ARTICLE_QUESTION_MARKER_ATTR } from "./articleQuestionNode";
import { CALLOUT_MARKER_ATTR } from "./calloutNode";

const ALLOWED_TAGS = [
  "p",
  "strong",
  "em",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
];

const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
};

export interface SanitizeHtmlOptions {
  /** Allow `img[src, alt]` tags. Default false — existing callers unchanged. */
  allowImages?: boolean;
  /** Allow `div[data-ally-question]` question placeholders. Default false. */
  allowQuestions?: boolean;
  /** Allow `div[data-ally-callout]` highlight boxes. Default false. */
  allowCallouts?: boolean;
}

/**
 * The opt-in variants, all for the track article builder, each adding exactly
 * one thing on top of the default allowlist:
 * - images: `img[src, alt]`;
 * - questions: the empty `div[data-ally-question]` placeholder that anchors a
 *   question in the body — the question itself, options and answer key
 *   included, is stored outside the HTML and never passes through here;
 * - callouts: `div[data-ally-callout]`, the highlight box wrapping its
 *   paragraphs.
 * No other attribute, data attribute or tag comes along with them.
 */
const buildConfig = ({ allowImages, allowQuestions, allowCallouts }: SanitizeHtmlOptions) => {
  if (!allowImages && !allowQuestions && !allowCallouts) return PURIFY_CONFIG;
  return {
    ...PURIFY_CONFIG,
    ALLOWED_TAGS: [
      ...ALLOWED_TAGS,
      ...(allowImages ? ["img"] : []),
      ...(allowQuestions || allowCallouts ? ["div"] : []),
    ],
    ALLOWED_ATTR: [
      ...(allowImages ? ["src", "alt"] : []),
      ...(allowQuestions ? [ARTICLE_QUESTION_MARKER_ATTR] : []),
      ...(allowCallouts ? [CALLOUT_MARKER_ATTR] : []),
    ],
  };
};

/**
 * Sanitize HTML content to allow only safe formatting tags.
 * Strips all attributes, scripts, images, links, iframes, and embeds
 * (images survive only when `allowImages` is set, question placeholders only
 * when `allowQuestions` is, and highlight boxes only when `allowCallouts` is).
 */
export function sanitizeHtml(html: string, options?: SanitizeHtmlOptions): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, buildConfig(options ?? {})) as unknown as string;
}

/**
 * Check whether a string contains any HTML tags.
 * Used to detect legacy plain-text descriptions for backward compatibility.
 */
export function containsHtmlTags(content: string): boolean {
  if (!content) return false;
  return /<[a-z][\s\S]*>/i.test(content);
}

/**
 * Extract visible text length from HTML, ignoring tags.
 * Useful for character counting in the editor.
 */
export function getVisibleTextLength(html: string): number {
  if (!html) return 0;
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").length;
}
