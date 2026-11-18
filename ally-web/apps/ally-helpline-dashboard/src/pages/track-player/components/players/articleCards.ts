import { ArticleQuestion } from "@types";

import { splitArticleHtml } from "./articleSegments";

export interface ArticleCardPhoto {
  src: string;
  alt: string;
}

export type ArticleCard =
  | { kind: "cover"; key: string }
  | {
      kind: "section";
      key: string;
      /** The `h2` that opens this card, shown as its title; null on a card it doesn't open. */
      title: string | null;
      /**
       * The `h2` of the section this card belongs to — on a card that carries
       * on a section after a question, the reminder of where the reader is.
       * Null before the first `h2`.
       */
      section: string | null;
      /** Body, without the opening `h2` and without a lifted photo. */
      html: string;
      /** A leading image lifted out of the body to head the card. */
      photo: ArticleCardPhoto | null;
    }
  | { kind: "question"; key: string; question: ArticleQuestion }
  | { kind: "end"; key: string };

interface SplitCardOptions {
  /** Whether there are takeaways or resources to end on. */
  hasEnd: boolean;
}

/** Serialise one node back to markup, escaping text (unlike `textContent`). */
const serialize = (node: Node): string => {
  if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).outerHTML;
  if (node.nodeType === Node.TEXT_NODE) {
    const holder = node.ownerDocument!.createElement("div");
    holder.appendChild(node.cloneNode());
    return holder.innerHTML;
  }
  return "";
};

/**
 * A card's photo: its first block when that block is an image, or a
 * paragraph holding nothing but one. The image is taken out of the body.
 */
const liftPhoto = (html: string): { html: string; photo: ArticleCardPhoto | null } => {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const first = Array.from(body.childNodes).find(
    node => node.nodeType === Node.ELEMENT_NODE || (node.textContent ?? "").trim().length > 0,
  );
  if (!first || first.nodeType !== Node.ELEMENT_NODE) return { html, photo: null };
  const element = first as Element;

  let image: HTMLImageElement | null = null;
  if (element.tagName === "IMG") {
    image = element as HTMLImageElement;
  } else if (
    element.tagName === "P" &&
    (element.textContent ?? "").trim().length === 0 &&
    element.querySelectorAll("img").length === 1 &&
    Array.from(element.children).every(child => child.tagName === "IMG" || child.tagName === "BR")
  ) {
    image = element.querySelector("img");
  }
  const src = image?.getAttribute("src");
  if (!image || !src) return { html, photo: null };

  element.remove();
  return { html: body.innerHTML, photo: { src, alt: image.getAttribute("alt") ?? "" } };
};

/**
 * Split a prepared article body into the cards the Cards layout pages
 * through, in reading order:
 *
 * 1. a cover card, always;
 * 2. a card per top-level `h2`, the heading becoming the card's title; any
 *    content before the first `h2` is a card of its own;
 * 3. a card per inline question, splitting the section it sits in — the rest
 *    of that section carries on in an untitled card after it;
 * 4. an end card for takeaways and resources, when there are any. Without
 *    them the last content card is the last card.
 *
 * Questions go through `splitArticleHtml`, so a nested or orphaned
 * placeholder is handled exactly as the scrolling layouts handle it.
 */
export function splitArticleCards(
  html: string,
  questions: ArticleQuestion[],
  { hasEnd }: SplitCardOptions,
): ArticleCard[] {
  const cards: ArticleCard[] = [{ kind: "cover", key: "cover" }];
  let section: string | null = null;
  let current: { title: string | null; html: string } | null = null;

  const flush = () => {
    if (current && (current.title || current.html.trim())) {
      const { html: body, photo } = liftPhoto(current.html);
      cards.push({
        kind: "section",
        key: `section-${cards.length}`,
        title: current.title,
        section,
        html: body,
        photo,
      });
    }
    current = null;
  };

  for (const segment of splitArticleHtml(html, questions)) {
    if (segment.kind === "question") {
      flush();
      cards.push({ kind: "question", key: segment.key, question: segment.question });
      continue;
    }
    const body = new DOMParser().parseFromString(segment.html, "text/html").body;
    for (const node of Array.from(body.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "H2") {
        flush();
        section = node.textContent?.trim() || null;
        current = { title: section, html: "" };
        continue;
      }
      current ??= { title: null, html: "" };
      current.html += serialize(node);
    }
  }
  flush();

  if (hasEnd) cards.push({ kind: "end", key: "end" });
  return cards;
}
