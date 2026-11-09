import { describe, expect, it } from "vitest";

import { prepareArticleHtml, sanitizeArticleRender } from "../articleHtml";
import { splitArticleHtml } from "../articleSegments";

const labels = { say: "Try saying", info: "Good to know", warn: "Watch out" };

const prepare = (html: string, dropCap = false) =>
  prepareArticleHtml(html, { labels, idPrefix: "a1", dropCap });

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html").body;

describe("prepareArticleHtml — callouts", () => {
  it.each([
    ["say", "Try saying", "“"],
    ["info", "Good to know", "i"],
    ["warn", "Watch out", "!"],
  ])("gives a %s box its icon and translated label", (kind, label, glyph) => {
    const { html } = prepare(`<div data-ally-callout="${kind}"><p>Body text</p></div>`);
    const box = parse(html).querySelector(`[data-ally-callout="${kind}"]`)!;
    expect(box).not.toBeNull();
    const icon = box.querySelector("[data-ally-callout-icon]")!;
    expect(icon.textContent).toBe(glyph);
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    const content = box.querySelector("[data-ally-callout-body]")!;
    expect(content.querySelector("[data-ally-callout-label]")!.textContent).toBe(label);
    expect(content.querySelector("p")!.textContent).toBe("Body text");
  });

  it("unwraps a callout of an unknown kind to plain prose", () => {
    const { html } = prepare(`<div data-ally-callout="shout"><p>Kept</p></div><p>After</p>`);
    expect(html).toBe("<p>Kept</p><p>After</p>");
  });

  it("unwraps a plain div, as the shared renderer did, but keeps question placeholders", () => {
    const { html } = prepare(`<div><p>One</p></div><div data-ally-question="q1"></div>`);
    expect(html).toBe(`<p>One</p><div data-ally-question="q1"></div>`);
  });

  it("strips script, handlers and unsafe URLs inside a callout", () => {
    const { html } = prepare(
      `<div data-ally-callout="warn" onclick="alert(1)"><img src="x" onerror="alert(2)"><script>alert(3)</script><p><a href="javascript:alert(4)">link</a></p></div>`,
    );
    expect(html).not.toMatch(/onclick|onerror|<script|javascript:|<a/i);
    expect(parse(html).querySelector("[data-ally-callout-label]")!.textContent).toBe("Watch out");
  });

  it("injects a label as text, never as markup", () => {
    const { html } = prepareArticleHtml(`<div data-ally-callout="say"><p>x</p></div>`, {
      labels: { ...labels, say: `<img src=x onerror="alert(1)">` },
      idPrefix: "a1",
    });
    expect(parse(html).querySelector("img")).toBeNull();
    expect(parse(html).querySelector("[data-ally-callout-label]")!.textContent).toBe(
      `<img src=x onerror="alert(1)">`,
    );
  });

  it("drops attributes an author cannot set (ids, the player's own markers)", () => {
    const { html } = prepare(
      `<p id="x" data-ally-dropcap="" data-ally-callout-label="">Hi</p><span data-ally-callout-icon="">!</span>`,
    );
    expect(html).toBe("<p>Hi</p>!");
  });

  it("wraps plain text in a paragraph and returns nothing for an empty body", () => {
    expect(prepare("Just words").html).toBe("<p>Just words</p>");
    expect(prepare("   ")).toEqual({ html: "", outline: [] });
  });
});

describe("prepareArticleHtml — outline and drop cap", () => {
  it("ids each top-level h2 and lists the non-empty ones", () => {
    const { html, outline } = prepare(
      `<h2>First</h2><p>a</p><h2> </h2><blockquote><h2>Nested</h2></blockquote><h2>Last</h2>`,
    );
    expect(outline).toEqual([
      { id: "a1-h0", text: "First" },
      { id: "a1-h2", text: "Last" },
    ]);
    expect(parse(html).querySelector("#a1-h0")!.textContent).toBe("First");
  });

  it("marks the first top-level paragraph with text for a drop cap only when asked", () => {
    const source = `<h2>T</h2><p><img src="a.png" alt=""></p><p>Opening line</p><p>Next</p>`;
    expect(prepare(source).html).not.toContain("data-ally-dropcap");
    const marked = parse(prepare(source, true).html).querySelectorAll("[data-ally-dropcap]");
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe("Opening line");
  });
});

describe("sanitizeArticleRender", () => {
  it("keeps the player's callout parts and heading ids", () => {
    const { html } = prepare(`<h2>T</h2><div data-ally-callout="info"><p>x</p></div>`);
    expect(sanitizeArticleRender(html)).toBe(html);
  });

  it("re-sanitizes what a split re-serialised, so escaped text can't turn into markup", () => {
    const { html } = prepare(
      `&lt;img src=x onerror=alert(1)&gt;<div data-ally-question="q1"></div>`,
    );
    const segments = splitArticleHtml(html, [
      {
        id: "q1",
        type: "mcq_single",
        prompt: "?",
        points: 1,
        options: [],
        answered: null,
        correctOptionId: null,
        explanation: null,
      },
    ]);
    const first = segments[0];
    expect(first.kind).toBe("html");
    const rendered = sanitizeArticleRender(first.kind === "html" ? first.html : "");
    expect(rendered).not.toMatch(/onerror/i);
  });
});
