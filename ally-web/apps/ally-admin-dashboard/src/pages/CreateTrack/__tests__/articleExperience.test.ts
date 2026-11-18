import { describe, expect, it } from "vitest";

import {
  ArticleContent,
  ArticleExperience,
  SimulationStatus,
  TrackDetail,
  TrackItemFormValue,
  TrackItemType,
} from "@types";

import {
  articleHasCardBreaks,
  countArticleWords,
  estimateReadingMinutes,
  validateArticlePresentation,
} from "../articleExperience";
import { deserializeTrack, serializeItem, validateTrackForPublish } from "../trackFormUtils";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("estimateReadingMinutes", () => {
  it("is at least one minute, even for an empty article", () => {
    expect(estimateReadingMinutes("")).toBe(1);
    expect(estimateReadingMinutes("<p>Hi</p>")).toBe(1);
  });

  it("rounds up at 200 words a minute", () => {
    expect(estimateReadingMinutes(`<p>${words(200)}</p>`)).toBe(1);
    expect(estimateReadingMinutes(`<p>${words(201)}</p>`)).toBe(2);
    expect(estimateReadingMinutes(`<p>${words(1000)}</p>`)).toBe(5);
  });

  it("counts the takeaways too", () => {
    expect(estimateReadingMinutes(`<p>${words(199)}</p>`, ["two words"])).toBe(2);
  });

  it("counts text, not markup, and does not glue words across tags", () => {
    expect(
      countArticleWords(
        '<h2>Title</h2><p>a&nbsp;<strong>b</strong></p><p>c</p><div data-ally-callout="say"><p>d e</p></div><div data-ally-question="q1"></div>',
      ),
    ).toBe(6);
  });

  it("ignores blank takeaways", () => {
    expect(countArticleWords("", ["  ", "one"])).toBe(1);
  });
});

describe("articleHasCardBreaks", () => {
  it("is true only when the body has an H2", () => {
    expect(articleHasCardBreaks("<h2>Part one</h2><p>x</p>")).toBe(true);
    expect(articleHasCardBreaks('<h2 class="x">Part</h2>')).toBe(true);
    expect(articleHasCardBreaks("<h1>Title</h1><h3>Sub</h3><p>x</p>")).toBe(false);
    expect(articleHasCardBreaks("")).toBe(false);
  });
});

const articleItem = (article: Partial<ArticleContent>): TrackItemFormValue =>
  ({
    localId: "i1",
    type: TrackItemType.ARTICLE,
    title: "Article",
    description: "",
    completionCriteria: {},
    article: { html: "<p>Body</p>", questions: [], ...article },
  }) as unknown as TrackItemFormValue;

const contentOf = (article: Partial<ArticleContent>) =>
  serializeItem(articleItem(article), 1).content as ArticleContent;

describe("serializeItem — article presentation", () => {
  it("leaves Classic out, so an untouched article saves exactly as before", () => {
    expect(contentOf({})).toEqual({ html: "<p>Body</p>" });
    expect(contentOf({ experience: ArticleExperience.CLASSIC })).toEqual({ html: "<p>Body</p>" });
  });

  it("sends Magazine and Cards", () => {
    expect(contentOf({ experience: ArticleExperience.MAGAZINE }).experience).toBe("MAGAZINE");
    expect(contentOf({ experience: ArticleExperience.CARDS }).experience).toBe("CARDS");
  });

  it("sends the cover, dropping an empty description", () => {
    expect(contentOf({ cover: { url: "https://cdn/x.png", alt: " A bench " } }).cover).toEqual({
      url: "https://cdn/x.png",
      alt: "A bench",
    });
    expect(contentOf({ cover: { url: "https://cdn/x.png", alt: "  " } }).cover).toEqual({
      url: "https://cdn/x.png",
    });
    expect(contentOf({ cover: { url: "" } })).not.toHaveProperty("cover");
  });

  it("trims the takeaways and drops blank rows", () => {
    expect(contentOf({ takeaways: [" Listen first ", "", "   ", "Then ask"] }).takeaways).toEqual([
      "Listen first",
      "Then ask",
    ]);
    expect(contentOf({ takeaways: ["", " "] })).not.toHaveProperty("takeaways");
  });

  it("does not turn callout markers or anything else in the body into extra keys", () => {
    const html = '<div data-ally-callout="warn"><p>Careful</p></div>';
    expect(contentOf({ html })).toEqual({ html });
  });
});

describe("article presentation round-trip: load → save", () => {
  const trackWith = (content: ArticleContent): TrackDetail => ({
    id: "track-1",
    title: "T",
    description: "d",
    coverImageUrl: "https://example.com/c.png",
    status: SimulationStatus.DRAFT,
    isGlobal: false,
    totalItems: 1,
    sections: [
      {
        id: "section-1",
        title: "S",
        description: "",
        order: 1,
        items: [{ id: "item-1", type: TrackItemType.ARTICLE, order: 1, title: "A", content }],
      },
    ],
  });

  const roundTrip = (content: ArticleContent) => {
    const form = deserializeTrack(trackWith(content));
    return serializeItem(form.sections[0].items[0], 1).content;
  };

  it("keeps experience, cover and takeaways", () => {
    const content: ArticleContent = {
      html: '<h2>One</h2><div data-ally-callout="say"><p>“How are you?”</p></div>',
      experience: ArticleExperience.CARDS,
      cover: { url: "https://cdn/cover.jpg", alt: "A bench" },
      takeaways: ["Listen first", "Then ask"],
    };
    expect(roundTrip(content)).toEqual(content);
  });

  it("keeps a classic article byte-identical", () => {
    const content: ArticleContent = { html: "<p>Read me</p>" };
    expect(roundTrip(content)).toEqual(content);
  });
});

describe("validateArticlePresentation", () => {
  it("accepts an article that uses none of it", () => {
    expect(validateArticlePresentation({ html: "<p>x</p>" })).toEqual([]);
  });

  it("accepts a full, valid set", () => {
    expect(
      validateArticlePresentation({
        html: "<p>x</p>",
        experience: ArticleExperience.MAGAZINE,
        cover: { url: "https://cdn/x.png", alt: "a".repeat(300) },
        takeaways: ["a".repeat(200), "", "b", "c", "d", "e"],
      }),
    ).toEqual([]);
  });

  it("rejects an unknown experience", () => {
    expect(
      validateArticlePresentation({ html: "", experience: "SLIDES" as ArticleExperience }),
    ).toContain("Article: reading experience must be Classic, Magazine or Cards");
  });

  it("rejects a cover that is not an https link, and an over-long description", () => {
    const errors = validateArticlePresentation({
      html: "",
      cover: { url: "http://cdn/x.png", alt: "a".repeat(301) },
    });
    expect(errors).toEqual([
      "Article: the cover photo must be an uploaded image (https link)",
      "Article: the cover photo description must be 300 characters or fewer",
    ]);
  });

  it("rejects more than five takeaways with text, and an over-long one", () => {
    expect(
      validateArticlePresentation({ html: "", takeaways: ["a", "b", "c", "d", "e", "f"] }),
    ).toContain("Article: at most 5 key takeaways");
    expect(validateArticlePresentation({ html: "", takeaways: ["ok", "a".repeat(201)] })).toEqual([
      "Article takeaway 2: keep it to 200 characters",
    ]);
  });

  it("is part of publish validation", () => {
    const messages = validateTrackForPublish({
      title: "T",
      description: "D",
      coverImageUrl: "https://example.com/c.png",
      isGlobal: false,
      sections: [
        {
          localId: "s1",
          title: "S",
          description: "",
          items: [articleItem({ cover: { url: "http://x/y.png" } })],
        },
      ],
    } as never).map(error => error.message);
    expect(messages).toContain("Article: the cover photo must be an uploaded image (https link)");
  });
});
