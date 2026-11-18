import { describe, expect, it } from "vitest";

import {
  articleExperience,
  articleReadingMinutes,
  articleTakeaways,
  isCardsArticle,
} from "../articleExperience";
import { ArticleExperience } from "../../../../../types/tracks";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("articleExperience", () => {
  it("reads MAGAZINE and CARDS, and anything else as CLASSIC", () => {
    expect(articleExperience({ experience: "MAGAZINE" })).toBe("MAGAZINE");
    expect(articleExperience({ experience: "CARDS" })).toBe("CARDS");
    expect(articleExperience({})).toBe("CLASSIC");
    expect(articleExperience({ experience: "STORY" as ArticleExperience })).toBe("CLASSIC");
    expect(isCardsArticle({ experience: "CARDS" })).toBe(true);
    expect(isCardsArticle({ experience: "MAGAZINE" })).toBe(false);
  });

  it("keeps only takeaways with text", () => {
    expect(articleTakeaways({ takeaways: [" One ", "", "  ", "Two"] })).toEqual(["One", "Two"]);
    expect(articleTakeaways({})).toEqual([]);
  });
});

describe("articleReadingMinutes", () => {
  it("is never under a minute", () => {
    expect(articleReadingMinutes("")).toBe(1);
    expect(articleReadingMinutes("<p>Short</p>")).toBe(1);
  });

  it("rounds up at 200 words a minute", () => {
    expect(articleReadingMinutes(`<p>${words(200)}</p>`)).toBe(1);
    expect(articleReadingMinutes(`<p>${words(201)}</p>`)).toBe(2);
    expect(articleReadingMinutes(`<p>${words(600)}</p>`)).toBe(3);
  });

  it("counts adjacent blocks as separate words and ignores markup", () => {
    // 2 words per block; without node-by-node gathering "a b" + "c d" -> "a bc d".
    const html = `${"<p>a b</p>".repeat(100)}<p>c<strong>d</strong></p>`;
    expect(articleReadingMinutes(html)).toBe(2);
  });

  it("adds the takeaways' words", () => {
    expect(articleReadingMinutes(`<p>${words(150)}</p>`, [words(30), words(30)])).toBe(2);
  });
});
