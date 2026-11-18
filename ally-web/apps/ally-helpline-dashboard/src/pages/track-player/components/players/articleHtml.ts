import DOMPurify from "dompurify";

import { ARTICLE_QUESTION_MARKER_ATTR } from "./articleSegments";

/** Marks a highlight box in the authored body: `<div data-ally-callout="say">`. */
export const ARTICLE_CALLOUT_ATTR = "data-ally-callout";
/** Parts the player adds inside a callout; never accepted from the author. */
const CALLOUT_ICON_ATTR = "data-ally-callout-icon";
const CALLOUT_LABEL_ATTR = "data-ally-callout-label";
const CALLOUT_BODY_ATTR = "data-ally-callout-body";
/** The paragraph Magazine opens with a drop cap. */
export const ARTICLE_DROP_CAP_ATTR = "data-ally-dropcap";

export const ARTICLE_CALLOUT_KINDS = ["say", "info", "warn"] as const;
export type ArticleCalloutKind = (typeof ARTICLE_CALLOUT_KINDS)[number];
export type ArticleCalloutLabels = Record<ArticleCalloutKind, string>;

const CALLOUT_GLYPHS: Record<ArticleCalloutKind, string> = {
  say: "“",
  info: "i",
  warn: "!",
};

/**
 * The article allow-list: the same tags and image attributes the shared
 * RichTextRenderer lets through for articles, plus the two block markers the
 * player reads — a callout `div` and a question placeholder `div`. Nothing
 * else survives: no other attributes, no links, no scripts or handlers.
 */
const ARTICLE_TAGS = [
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
  "img",
  "div",
];

const AUTHORED_CONFIG = {
  ALLOWED_TAGS: ARTICLE_TAGS,
  ALLOWED_ATTR: ["src", "alt", ARTICLE_CALLOUT_ATTR, ARTICLE_QUESTION_MARKER_ATTR],
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
};

/**
 * What may reach the page: the authored allow-list plus the parts the player
 * itself adds (callout icon/label wrappers, heading ids, the drop-cap mark).
 */
const RENDER_CONFIG = {
  ALLOWED_TAGS: [...ARTICLE_TAGS, "span"],
  ALLOWED_ATTR: [
    "src",
    "alt",
    "id",
    "aria-hidden",
    ARTICLE_CALLOUT_ATTR,
    CALLOUT_ICON_ATTR,
    CALLOUT_LABEL_ATTR,
    CALLOUT_BODY_ATTR,
    ARTICLE_DROP_CAP_ATTR,
  ],
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
};

const containsHtmlTags = (content: string): boolean => /<[a-z][\s\S]*>/i.test(content);

const isCalloutKind = (value: string | null): value is ArticleCalloutKind =>
  (ARTICLE_CALLOUT_KINDS as readonly string[]).includes(value ?? "");

/** Replace an element with its own children. */
const unwrap = (element: Element) => {
  element.replaceWith(...Array.from(element.childNodes));
};

export interface ArticleOutlineEntry {
  id: string;
  text: string;
}

export interface PreparedArticle {
  /** Sanitized body, question placeholders kept, ready to split and render. */
  html: string;
  /** The top-level `h2`s, in order, with the ids they were given. */
  outline: ArticleOutlineEntry[];
}

interface PrepareOptions {
  /** Translated callout labels ("Try saying", …). */
  labels: ArticleCalloutLabels;
  /** Prefix for the ids given to top-level headings. */
  idPrefix: string;
  /** Mark the first top-level paragraph with text for a drop cap. */
  dropCap?: boolean;
}

/**
 * Turn an authored article body into what the player renders.
 *
 * The body is sanitized first, so everything after works on markup that is
 * already safe; the player then only adds elements of its own, built with
 * DOM calls and `textContent` (never parsed from strings):
 * - each known callout gets an icon square and its translated label, with
 *   the authored content wrapped beside them. A callout of an unknown kind
 *   (a newer editor, a hand-edited body) is unwrapped to plain prose rather
 *   than shown as an unlabelled box. Any other `div` is unwrapped too, as the
 *   shared renderer always did;
 * - each top-level `h2` gets an id, so the outline can scroll to it;
 * - optionally, the first paragraph is marked for a drop cap.
 *
 * Question placeholders are left in place for `splitArticleHtml`.
 */
export function prepareArticleHtml(html: string, options: PrepareOptions): PreparedArticle {
  if (!html || html.trim().length === 0) return { html: "", outline: [] };
  const normalized = containsHtmlTags(html) ? html : `<p>${html}</p>`;
  const body = DOMPurify.sanitize(normalized, {
    ...AUTHORED_CONFIG,
    RETURN_DOM: true,
  }) as unknown as HTMLElement;
  const doc = body.ownerDocument;

  for (const div of Array.from(body.querySelectorAll("div"))) {
    if (div.hasAttribute(ARTICLE_QUESTION_MARKER_ATTR)) continue;
    const kind = div.getAttribute(ARTICLE_CALLOUT_ATTR);
    if (!isCalloutKind(kind)) {
      unwrap(div);
      continue;
    }
    const icon = doc.createElement("span");
    icon.setAttribute(CALLOUT_ICON_ATTR, "");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = CALLOUT_GLYPHS[kind];

    const label = doc.createElement("span");
    label.setAttribute(CALLOUT_LABEL_ATTR, "");
    label.textContent = options.labels[kind];

    const content = doc.createElement("div");
    content.setAttribute(CALLOUT_BODY_ATTR, "");
    content.append(label, ...Array.from(div.childNodes));
    div.replaceChildren(icon, content);
  }

  const outline: ArticleOutlineEntry[] = [];
  Array.from(body.children)
    .filter(element => element.tagName === "H2")
    .forEach((heading, index) => {
      const id = `${options.idPrefix}-h${index}`;
      heading.id = id;
      const text = heading.textContent?.trim() ?? "";
      if (text) outline.push({ id, text });
    });

  if (options.dropCap) {
    const first = Array.from(body.children).find(
      element => element.tagName === "P" && (element.textContent ?? "").trim().length > 0,
    );
    first?.setAttribute(ARTICLE_DROP_CAP_ATTR, "");
  }

  return { html: body.innerHTML, outline };
}

/**
 * The last pass before a prepared segment reaches the page. Splitting a body
 * re-serialises it, so this re-applies the allow-list (with the player's own
 * additions) rather than trusting the string it is handed.
 */
export function sanitizeArticleRender(html: string): string {
  if (!html || html.trim().length === 0) return "";
  return DOMPurify.sanitize(html, RENDER_CONFIG) as unknown as string;
}
