import "@constants";
import { describe, expect, it } from "vitest";

import type { ManualChangeRow, ManualPageRow } from "@types";

import { withRecentPage } from "../hooks/useRecentPages";
import {
  MAP_COLUMN_GAP,
  MAP_COLUMN_WIDTH,
  MAP_ROW_GAP,
  boxHeight,
  mapColumns,
  mapGrid,
  neighboursOf,
} from "../utils/mapLayout";
import { pickRevertTarget } from "../utils/revertTarget";
import { decodeEntities, parseSnippet, stripSnippetMarkdown } from "../utils/snippet";
import { ancestorsOf, buildTree, collectFacets, flattenVisible, siblingPager } from "../utils/tree";
import {
  escapeMarkdownText,
  extractHeadings,
  headingId,
  preprocessWikilinks,
  slugFromManualHref,
  wikilinkSlugs,
} from "../utils/wikilinks";

describe("preprocessWikilinks", () => {
  const known = new Set(["running-a-roleplay", "scores"]);

  it("links a slug the tree has, with the slug as its text", () => {
    expect(preprocessWikilinks("See [[scores]].", known)).toBe(
      "See [scores](/roadmap/manual/scores).",
    );
  });

  it("uses the label form's label", () => {
    expect(
      preprocessWikilinks("Read [[running-a-roleplay|how a roleplay runs]] first.", known),
    ).toBe("Read [how a roleplay runs](/roadmap/manual/running-a-roleplay) first.");
  });

  it("shows the target page's title for an unlabelled link, the label when given", () => {
    const titles = new Map([
      ["start-a-roleplay", "Start a roleplay"],
      ["concepts-and-terms", "Concepts and terms"],
    ]);
    expect(
      preprocessWikilinks(
        "See [[concepts-and-terms]], then [[start-a-roleplay|begin here]] and [[gone]].",
        titles,
      ),
    ).toBe(
      "See [Concepts and terms](/roadmap/manual/concepts-and-terms), then [begin here](/roadmap/manual/start-a-roleplay) and gone.",
    );
    expect(extractHeadings("## About [[concepts-and-terms]]", titles)[0].text).toBe(
      "About Concepts and terms",
    );
  });

  it("renders a slug the tree doesn't have as plain text", () => {
    expect(preprocessWikilinks("Soon: [[not-yet|the new page]] and [[gone]].", known)).toBe(
      "Soon: the new page and gone.",
    );
  });

  it("escapes markdown in labels so a label can't add markup or a second link", () => {
    expect(preprocessWikilinks("[[scores|a *b* (c) <d> [e]]", known)).toBe(
      "[a \\*b\\* \\(c\\) \\<d\\> \\[e](/roadmap/manual/scores)",
    );
    expect(escapeMarkdownText("<img>")).toBe("\\<img\\>");
  });

  it("never links a slug that breaks the slug rule, even if listed", () => {
    expect(preprocessWikilinks("[[Bad Slug]]", new Set(["Bad Slug"]))).toBe("Bad Slug");
  });

  it("leaves wikilinks inside code alone", () => {
    const body = "Use `[[scores]]` like this:\n\n```\n[[scores]]\n```\n\nand [[scores]].";
    expect(preprocessWikilinks(body, known)).toBe(
      "Use `[[scores]]` like this:\n\n```\n[[scores]]\n```\n\nand [scores](/roadmap/manual/scores).",
    );
  });

  it("lists every slug a body mentions once, outside code", () => {
    expect(wikilinkSlugs("[[a]] [[b|B]] `[[c]]` [[a]]")).toEqual(["a", "b"]);
  });

  it("reads a slug back from an internal href only", () => {
    expect(slugFromManualHref("/roadmap/manual/scores#top")).toBe("scores");
    expect(slugFromManualHref("https://example.com/roadmap/manual/scores")).toBeNull();
    expect(slugFromManualHref("/roadmap/manual/../x")).toBeNull();
  });
});

describe("headings", () => {
  it("gives headings stable ids and lists h2/h3 outside code", () => {
    expect(headingId("How scoring works!")).toBe("how-scoring-works");
    const body =
      "# Title\n\n## How [[scores|scoring]] works\n\n```\n## not this\n```\n\n### *Edge* cases";
    expect(extractHeadings(body)).toEqual([
      { level: 2, text: "How scoring works", id: "how-scoring-works" },
      { level: 3, text: "Edge cases", id: "edge-cases" },
    ]);
  });
});

describe("parseSnippet", () => {
  it("splits on <mark> into highlighted and plain parts", () => {
    expect(parseSnippet("a <mark>roleplay</mark> starts")).toEqual([
      { text: "a ", mark: false },
      { text: "roleplay", mark: true },
      { text: " starts", mark: false },
    ]);
  });

  it("keeps any other tag as literal text (rendered as text, never as HTML)", () => {
    const parts = parseSnippet('<img src=x onerror="alert(1)"><mark>hi</mark>');
    expect(parts).toEqual([
      { text: '<img src=x onerror="alert(1)">', mark: false },
      { text: "hi", mark: true },
    ]);
  });

  it("decodes only the server's escaped entities", () => {
    expect(parseSnippet("&lt;b&gt; &amp; <mark>&quot;x&quot;</mark>")).toEqual([
      { text: "<b> & ", mark: false },
      { text: '"x"', mark: true },
    ]);
    expect(decodeEntities("&#x3C;script&#x3E;")).toBe("&#x3C;script&#x3E;");
  });

  it("decodes &#39; and &amp; in both plain and marked pieces (seen live: learner&#39;s)", () => {
    expect(parseSnippet("the <mark>learner&#39;s</mark> score &amp; notes")).toEqual([
      { text: "the ", mark: false },
      { text: "learner's", mark: true },
      { text: " score & notes", mark: false },
    ]);
  });

  it("decodes exactly the five server entities and leaves others alone", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&#39;")).toBe("&<>\"'");
    expect(decodeEntities("&apos; &nbsp; &#x27;")).toBe("&apos; &nbsp; &#x27;");
    // Decoded once only: an escaped entity stays an entity.
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("strips markdown from snippets without touching the highlights", () => {
    expect(
      parseSnippet(
        "## Scores\n**Your** [[scores|<mark>score</mark> page]] and [[start-a-roleplay]] `code`",
      ),
    ).toEqual([
      { text: "Scores\nYour ", mark: false },
      { text: "score", mark: true },
      { text: " page and start-a-roleplay code", mark: false },
    ]);
    expect(stripSnippetMarkdown("ing-a-roleplay|how it runs]] then [[sco")).toBe(
      "how it runs then sco",
    );
    expect(stripSnippetMarkdown("a | b, #tag")).toBe("a | b, #tag");
  });

  it("handles empty input and an unclosed mark", () => {
    expect(parseSnippet("")).toEqual([]);
    expect(parseSnippet(null)).toEqual([]);
    expect(parseSnippet("<mark>open")).toEqual([{ text: "open", mark: true }]);
  });
});

const change = (
  id: string,
  at: string,
  overrides: Partial<ManualChangeRow> = {},
): ManualChangeRow => ({
  id,
  slug: "scores",
  pageTitle: "Scores",
  at,
  authorKind: "chat",
  authorLabel: "Chat",
  reason: null,
  revertOf: null,
  ...overrides,
});

describe("pickRevertTarget", () => {
  const log = [
    change("r3", "2026-11-25T10:00:00Z"),
    change("r2", "2026-11-24T10:00:00Z"),
    change("r1", "2026-11-20T10:00:00Z"),
  ];

  it("picks the revision just before the edit", () => {
    expect(pickRevertTarget(log, "r3")?.id).toBe("r2");
    expect(pickRevertTarget(log, "r2")?.id).toBe("r1");
  });

  it("sorts newest first whatever order the log arrives in", () => {
    expect(pickRevertTarget([...log].reverse(), "r3")?.id).toBe("r2");
  });

  it("returns null for the first revision or an unknown one", () => {
    expect(pickRevertTarget(log, "r1")).toBeNull();
    expect(pickRevertTarget(log, "nope")).toBeNull();
  });

  it("only considers the page's own revisions when a slug is given", () => {
    const mixed = [change("x", "2026-11-24T12:00:00Z", { slug: "other" }), ...log];
    expect(pickRevertTarget(mixed, "r3", "scores")?.id).toBe("r2");
  });
});

const row = (slug: string, overrides: Partial<ManualPageRow> = {}): ManualPageRow => ({
  slug,
  title: slug,
  summary: "",
  parentSlug: null,
  position: 0,
  kind: "page",
  roles: [],
  surfaces: [],
  journeys: [],
  releaseState: "live",
  verifiedAt: null,
  updatedAt: "2026-11-20T10:00:00Z",
  ...overrides,
});

describe("tree", () => {
  const rows = [
    row("learn", { kind: "section", position: 2, title: "Learn" }),
    row("start", { kind: "section", position: 1, title: "Start" }),
    row("sign-in", { parentSlug: "start", position: 1, roles: ["learner"], surfaces: ["mobile"] }),
    row("invite", { parentSlug: "start", position: 0, roles: ["admin"], surfaces: ["admin"] }),
    row("roleplay", { parentSlug: "learn", roles: ["learner"], surfaces: ["mobile", "web"] }),
    row("orphan", { parentSlug: "missing", position: 5 }),
  ];

  it("nests pages under sections in position order, orphans at the top level", () => {
    const tree = buildTree(rows);
    expect(tree.map(node => node.slug)).toEqual(["start", "learn", "orphan"]);
    expect(tree[0].children.map(node => node.slug)).toEqual(["invite", "sign-in"]);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it("filters by role and surface, keeping sections with a match", () => {
    const byRole = buildTree(rows, { role: "learner" });
    expect(byRole.map(node => node.slug)).toEqual(["start", "learn"]);
    expect(byRole[0].children.map(node => node.slug)).toEqual(["sign-in"]);
    const both = buildTree(rows, { role: "learner", surface: "web" });
    expect(both.map(node => node.slug)).toEqual(["learn"]);
    expect(buildTree(rows, { role: "nobody" })).toEqual([]);
  });

  it("survives a parent cycle", () => {
    const cyclic = [row("a", { parentSlug: "b" }), row("b", { parentSlug: "a" })];
    expect(() => buildTree(cyclic)).not.toThrow();
  });

  it("collects sorted facets", () => {
    expect(collectFacets(rows)).toEqual({
      roles: ["admin", "learner"],
      surfaces: ["admin", "mobile", "web"],
    });
  });

  it("flattens only open sections, and finds a page's ancestors", () => {
    const tree = buildTree(rows);
    expect(flattenVisible(tree, slug => slug === "start").map(node => node.slug)).toEqual([
      "start",
      "invite",
      "sign-in",
      "learn",
      "orphan",
    ]);
    expect(ancestorsOf(rows, "sign-in")).toEqual(["start"]);
    expect(ancestorsOf(rows, null)).toEqual([]);
  });

  it("pages through siblings in the same section", () => {
    expect(siblingPager(rows, "invite")).toEqual({ previous: null, next: rows[2] });
    expect(siblingPager(rows, "sign-in").previous?.slug).toBe("invite");
  });
});

describe("map layout", () => {
  const graph = {
    nodes: [
      { slug: "start", title: "Start", parentSlug: null, kind: "section" as const },
      { slug: "sub", title: "Sub", parentSlug: "start", kind: "section" as const },
      { slug: "a", title: "A", parentSlug: "sub", kind: "page" as const },
      { slug: "b", title: "B", parentSlug: "start", kind: "page" as const },
      { slug: "loose", title: "Loose", parentSlug: null, kind: "page" as const },
    ],
    edges: [{ from: "a", to: "b" }],
  };

  it("makes a column per top-level section, nested pages flattened, loose pages last", () => {
    const columns = mapColumns(graph);
    expect(columns.map(column => column.section?.slug ?? null)).toEqual(["start", null]);
    expect(columns[0].pages.map(page => page.slug)).toEqual(["sub", "a", "b"]);
    expect(columns[1].pages.map(page => page.slug)).toEqual(["loose"]);
  });

  it("wraps sections into a roughly square grid so the map can be read", () => {
    const sections = Array.from({ length: 19 }, (_, index) => ({
      slug: `s${index}`,
      title: `S${index}`,
      parentSlug: null,
      kind: "section" as const,
    }));
    const pages = sections.map(section => ({
      slug: `${section.slug}-p`,
      title: "P",
      parentSlug: section.slug,
      kind: "page" as const,
    }));
    pages.push({ slug: "s0-q", title: "Q", parentSlug: "s0", kind: "page" });
    const { boxes, perRow } = mapGrid(mapColumns({ nodes: [...sections, ...pages], edges: [] }));
    expect(perRow).toBe(5);
    expect(boxes).toHaveLength(19);
    expect(new Set(boxes.map(box => box.y)).size).toBe(4);
    expect(boxes[4].x).toBe(4 * (MAP_COLUMN_WIDTH + MAP_COLUMN_GAP));
    // The second row starts below the first row's tallest box (s0 has two pages).
    expect(boxes[5]).toMatchObject({ x: 0, y: boxHeight(2) + MAP_ROW_GAP });
    expect(boxes[0].height).toBe(boxHeight(2));
    expect(mapGrid([]).boxes).toEqual([]);
  });

  it("finds neighbours both ways", () => {
    expect([...neighboursOf(graph, "b")].sort()).toEqual(["a", "b"]);
    expect(neighboursOf(graph, null).size).toBe(0);
  });
});

describe("recent pages", () => {
  it("puts the newest first without duplicates and caps the list", () => {
    let list = withRecentPage([], { slug: "a", title: "A" });
    list = withRecentPage(list, { slug: "b", title: "B" });
    list = withRecentPage(list, { slug: "a", title: "A" });
    expect(list.map(page => page.slug)).toEqual(["a", "b"]);
    for (let index = 0; index < 10; index += 1) {
      list = withRecentPage(list, { slug: `p${index}`, title: `P${index}` });
    }
    expect(list).toHaveLength(6);
  });
});
