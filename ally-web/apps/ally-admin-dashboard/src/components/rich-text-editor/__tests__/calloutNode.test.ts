import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { ArticleQuestionNode } from "../articleQuestionNode";
import { CalloutNode } from "../calloutNode";
import { sanitizeHtml } from "../richTextSanitizer";

/**
 * Real TipTap schema, as for the question node: the box's job is to come
 * back out of `getHTML()` as exactly the marker the server validates and the
 * learner players draw, and to survive being read back in.
 */
const makeEditor = (content = "", mounted = false) =>
  new Editor({
    ...(mounted ? { element: document.createElement("div") } : {}),
    extensions: [StarterKit, ArticleQuestionNode, CalloutNode],
    content,
  });

describe("CalloutNode", () => {
  it.each(["say", "info", "warn"])("round-trips a %s box unchanged", kind => {
    const html = `<p>Before</p><div data-ally-callout="${kind}"><p>One <strong>bold</strong> line</p><p>Two</p></div><p>After</p>`;
    const editor = makeEditor(html);

    expect(editor.getHTML()).toBe(html);
    editor.destroy();
  });

  it("wraps the selected paragraph in a box of the chosen kind", () => {
    const editor = makeEditor("<p>Say this</p>");
    editor.chain().setTextSelection(2).setCallout("say").run();

    // StarterKit's trailing node then adds an empty paragraph after the box,
    // so the author can carry on typing below it.
    expect(editor.getHTML()).toMatch(/^<div data-ally-callout="say"><p>Say this<\/p><\/div>/);
    editor.destroy();
  });

  it("switches the kind of the box the cursor is in, rather than nesting", () => {
    const editor = makeEditor('<div data-ally-callout="say"><p>Text</p></div>');
    editor.chain().setTextSelection(3).setCallout("warn").run();

    expect(editor.getHTML()).toMatch(/^<div data-ally-callout="warn"><p>Text<\/p><\/div>/);
    expect(editor.getHTML()).not.toContain("say");
    editor.destroy();
  });

  it("removes the box and keeps its text", () => {
    const editor = makeEditor('<div data-ally-callout="info"><p>Text</p></div>');
    editor.chain().setTextSelection(3).unsetCallout().run();

    expect(editor.getHTML()).toBe("<p>Text</p>");
    editor.destroy();
  });

  it("does not read an unknown kind as a box; its text survives as paragraphs", () => {
    const editor = makeEditor('<div data-ally-callout="evil"><p>Text</p></div>');

    expect(editor.getHTML()).toBe("<p>Text</p>");
    editor.destroy();
  });

  it("only holds paragraphs — a heading pasted inside is not kept as a heading in the box", () => {
    const editor = makeEditor('<div data-ally-callout="say"><h2>Title</h2></div>');

    expect(editor.getHTML()).not.toContain('<div data-ally-callout="say"><h2>');
    expect(editor.getHTML()).toContain("Title");
    editor.destroy();
  });

  it("draws the label in the editor without putting it in the HTML", () => {
    const editor = makeEditor('<div data-ally-callout="warn"><p>Careful</p></div>', true);

    expect(editor.view.dom.textContent).toContain("WATCH OUT");
    expect(editor.getHTML()).not.toContain("WATCH OUT");
    editor.destroy();
  });

  it("sits alongside question placeholders", () => {
    const html =
      '<div data-ally-callout="info"><p>Note</p></div><div data-ally-question="q1"></div>';
    const editor = makeEditor(html);

    expect(editor.getHTML()).toBe(html);
    editor.destroy();
  });
});

describe("sanitizeHtml — highlight boxes", () => {
  const box = '<div data-ally-callout="say"><p>Hi</p></div>';

  it("strips the marker by default, keeping the text", () => {
    expect(sanitizeHtml(box)).toBe("<p>Hi</p>");
  });

  it("keeps the box when callouts are allowed", () => {
    expect(sanitizeHtml(box, { allowCallouts: true })).toBe(box);
  });

  it("keeps boxes, question placeholders and images together", () => {
    const html = `<img src="https://x/y.png" alt="y">${box}<div data-ally-question="q1"></div>`;
    expect(
      sanitizeHtml(html, { allowImages: true, allowQuestions: true, allowCallouts: true }),
    ).toBe(html);
  });

  it("does not let a question placeholder through on the callout allowance alone", () => {
    const html = sanitizeHtml(`${box}<div data-ally-question="q1"></div>`, {
      allowCallouts: true,
    });
    expect(html).toContain("data-ally-callout");
    expect(html).not.toContain("data-ally-question");
  });

  it("does not open the door to other attributes on the box", () => {
    const html = sanitizeHtml(
      '<div data-ally-callout="say" data-evil="1" onclick="alert(1)" style="color:red"><p>Hi</p></div>',
      { allowCallouts: true },
    );
    expect(html).toBe(box);
  });
});
