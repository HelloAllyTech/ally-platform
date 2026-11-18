import { describe, expect, it } from "vitest";

import { ArticleCard, splitArticleCards } from "../articleCards";
import { ArticleQuestion } from "../../../../../types/tracks";

const question = (id: string): ArticleQuestion => ({
  id,
  type: "mcq_single",
  prompt: `Prompt ${id}`,
  points: 1,
  options: [{ id: "a", text: "A" }],
  answered: null,
  correctOptionId: null,
  explanation: null,
});

const marker = (id: string) => `<div data-ally-question="${id}"></div>`;

/** A compact view of the deck: kind and the fields that matter per kind. */
const shape = (cards: ArticleCard[]) =>
  cards.map(card => {
    switch (card.kind) {
      case "section":
        return {
          kind: card.kind,
          title: card.title,
          section: card.section,
          html: card.html,
          photo: card.photo,
        };
      case "question":
        return { kind: card.kind, id: card.question.id };
      default:
        return { kind: card.kind };
    }
  });

describe("splitArticleCards", () => {
  it("starts with a cover and gives each h2 its own card, the h2 as title", () => {
    const cards = splitArticleCards(`<h2>One</h2><p>a</p><h2>Two</h2><p>b</p><p>c</p>`, [], {
      hasEnd: false,
    });
    expect(shape(cards)).toEqual([
      { kind: "cover" },
      { kind: "section", title: "One", section: "One", html: "<p>a</p>", photo: null },
      { kind: "section", title: "Two", section: "Two", html: "<p>b</p><p>c</p>", photo: null },
    ]);
  });

  it("gives content before the first h2 a card of its own, and skips it when empty", () => {
    expect(
      shape(splitArticleCards(`<p>Intro</p><h2>One</h2><p>a</p>`, [], { hasEnd: false })),
    ).toEqual([
      { kind: "cover" },
      { kind: "section", title: null, section: null, html: "<p>Intro</p>", photo: null },
      { kind: "section", title: "One", section: "One", html: "<p>a</p>", photo: null },
    ]);
    expect(splitArticleCards(`  <h2>One</h2><p>a</p>`, [], { hasEnd: false })).toHaveLength(2);
  });

  it("makes each question its own card, splitting the section around it", () => {
    const cards = splitArticleCards(
      `<h2>One</h2><p>a</p>${marker("q1")}<p>b</p><h2>Two</h2>${marker("q2")}`,
      [question("q1"), question("q2")],
      { hasEnd: false },
    );
    expect(shape(cards)).toEqual([
      { kind: "cover" },
      { kind: "section", title: "One", section: "One", html: "<p>a</p>", photo: null },
      { kind: "question", id: "q1" },
      { kind: "section", title: null, section: "One", html: "<p>b</p>", photo: null },
      { kind: "section", title: "Two", section: "Two", html: "", photo: null },
      { kind: "question", id: "q2" },
    ]);
  });

  it("drops a placeholder with no question, as the scrolling layouts do", () => {
    const cards = splitArticleCards(`<p>a</p>${marker("ghost")}<p>b</p>`, [], { hasEnd: false });
    expect(cards.map(c => c.kind)).toEqual(["cover", "section"]);
  });

  it("lifts a leading image, bare or alone in a paragraph, as the card's photo", () => {
    const cards = splitArticleCards(
      `<h2>One</h2><p><img src="/room.svg" alt="A room"></p><p>a</p><h2>Two</h2><img src="/mug.svg"><p>b</p>`,
      [],
      { hasEnd: false },
    );
    expect(shape(cards).slice(1)).toEqual([
      {
        kind: "section",
        title: "One",
        section: "One",
        html: "<p>a</p>",
        photo: { src: "/room.svg", alt: "A room" },
      },
      {
        kind: "section",
        title: "Two",
        section: "Two",
        html: "<p>b</p>",
        photo: { src: "/mug.svg", alt: "" },
      },
    ]);
  });

  it("leaves an image that isn't first, or shares its paragraph with text, in the body", () => {
    const cards = splitArticleCards(
      `<h2>One</h2><p>a</p><img src="/x.svg"><h2>Two</h2><p>Look <img src="/y.svg"></p>`,
      [],
      { hasEnd: false },
    );
    expect(cards.slice(1).every(c => c.kind === "section" && c.photo === null)).toBe(true);
  });

  it("ends on an end card only when there are takeaways or resources", () => {
    expect(splitArticleCards(`<p>a</p>`, [], { hasEnd: true }).map(c => c.kind)).toEqual([
      "cover",
      "section",
      "end",
    ]);
    expect(splitArticleCards(`<p>a</p>`, [], { hasEnd: false }).map(c => c.kind)).toEqual([
      "cover",
      "section",
    ]);
  });

  it("is just the cover for an empty body", () => {
    expect(splitArticleCards("", [], { hasEnd: false }).map(c => c.kind)).toEqual(["cover"]);
  });

  it("keeps escaped text escaped when re-serialising", () => {
    const cards = splitArticleCards(`<h2>One</h2>&lt;b&gt;not bold&lt;/b&gt;`, [], {
      hasEnd: false,
    });
    const section = cards[1];
    expect(section.kind === "section" && section.html).toBe("&lt;b&gt;not bold&lt;/b&gt;");
  });
});
