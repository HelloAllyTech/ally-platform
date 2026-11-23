import { describe, expect, it } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

// eslint-disable-next-line import/first
import { parseAnchorKey, segmentText, selectionToAnchor } from "../expertReviewSelection";

describe("expert review selection helpers", () => {
  it("highlights each comment's span, earlier comments keeping an overlap", () => {
    expect(
      segmentText("I cannot sleep before exams.", [
        { id: "a", spanStart: 2, spanEnd: 8, status: "open" },
        { id: "b", spanStart: 6, spanEnd: 14, status: "resolved" },
      ]),
    ).toEqual([
      { text: "I ", commentId: null, resolved: false },
      { text: "cannot", commentId: "a", resolved: false },
      { text: " sleep", commentId: "b", resolved: true },
      { text: " before exams.", commentId: null, resolved: false },
    ]);
  });

  it("turns a selection inside one line into offsets in that line, trimmed", () => {
    document.body.innerHTML = `<p><span data-anchor="turn:2">I <mark>cannot</mark> sleep before exams.</span></p>`;
    const line = document.querySelector("[data-anchor]") as HTMLElement;
    const range = document.createRange();
    range.setStart(line.firstChild as Text, 1); // the space before "cannot"
    const after = line.childNodes[2] as Text; // " sleep before exams."
    range.setEnd(after, 6);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionToAnchor(selection)).toEqual({
      anchorKind: "transcript",
      turnIndex: 2,
      spanStart: 2,
      spanEnd: 14,
      quotedText: "cannot sleep",
    });
  });

  it("ignores a selection that crosses two lines", () => {
    document.body.innerHTML = `<span data-anchor="turn:1">one</span><span data-anchor="card:opening">two</span>`;
    const [a, b] = Array.from(document.querySelectorAll("[data-anchor]"));
    const range = document.createRange();
    range.setStart(a.firstChild as Text, 0);
    range.setEnd(b.firstChild as Text, 2);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionToAnchor(selection)).toBeNull();
  });
});

describe("anchor keys", () => {
  it("reads a turn, a card field and an Ask Ally exchange", () => {
    expect(parseAnchorKey("turn:3")).toEqual({ anchorKind: "transcript", turnIndex: 3 });
    expect(parseAnchorKey("card:work_on_this[0].why")).toEqual({
      anchorKind: "card",
      section: "work_on_this[0].why",
    });
    expect(parseAnchorKey("ask:1")).toEqual({ anchorKind: "debrief", section: "ask_ally[1]" });
    expect(parseAnchorKey("nope")).toBeNull();
  });
});
