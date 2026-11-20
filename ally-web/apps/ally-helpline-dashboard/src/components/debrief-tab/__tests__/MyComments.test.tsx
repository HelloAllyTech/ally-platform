import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DebriefMyComment } from "@types";

import { applyHighlights, HIGHLIGHT_NAME, rangeForSpan, rangesFor } from "../highlightRanges";
import {
  SelectionCommentPopup,
  SelectionCommentsProvider,
  SelectionFeedbackComposer,
} from "../SelectionComments";

vi.mock("@api", () => ({
  useAddDebriefCommentsMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
  }),
}));

const BODY = "You named it plainly instead of moving on. That gave her room.";
const WORDS = "named it plainly";
const start = BODY.indexOf(WORDS);

const mine = (over: Partial<DebriefMyComment> = {}): DebriefMyComment => ({
  id: "c1",
  section: "what_worked[0].body",
  quotedText: WORDS,
  spanStart: start,
  spanEnd: start + WORDS.length,
  body: "Exactly what I needed.",
  createdAt: "2026-11-19T08:00:00Z",
  ...over,
});

const cards = () => {
  const root = document.createElement("div");
  root.innerHTML =
    `<p data-anchor="card:what_worked[0].body">${BODY}</p>` +
    `<blockquote><span data-anchor="card:what_worked[0].quote" data-anchor-wrap="1">“Are you lonely?”</span></blockquote>`;
  document.body.appendChild(root);
  return root;
};

describe("finding the words a person commented on", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("builds a range over exactly those characters", () => {
    const line = cards().querySelector("p") as HTMLElement;
    expect(rangeForSpan(line, start, start + WORDS.length)?.toString()).toBe(WORDS);
    expect(rangeForSpan(line, 0, 4)?.toString()).toBe("You ");
    expect(rangeForSpan(line, 5, 5)).toBeNull();
    expect(rangeForSpan(line, 0, 999)).toBeNull();
  });

  it("skips the quotation marks of a quote line", () => {
    const root = cards();
    const [range] = rangesFor(root, [
      mine({ section: "what_worked[0].quote", spanStart: 0, spanEnd: 3, quotedText: "Are" }),
    ]);
    expect(range.toString()).toBe("Are");
  });

  it("ignores a comment on the whole debrief, and one whose line is gone", () => {
    const root = cards();
    expect(
      rangesFor(root, [
        mine({ section: null, quotedText: null, spanStart: null, spanEnd: null }),
        mine({ id: "c2", section: "work_on_this[3].why" }),
      ]),
    ).toEqual([]);
  });

  it("marks them with the browser highlight where there is one, and clears it", () => {
    const set = vi.fn();
    const del = vi.fn();
    class FakeHighlight {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    vi.stubGlobal("CSS", { highlights: { set, delete: del } });
    vi.stubGlobal("Highlight", FakeHighlight);
    const clear = applyHighlights(cards(), [mine()]);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0]).toBe(HIGHLIGHT_NAME);
    expect((set.mock.calls[0][1] as FakeHighlight).ranges[0].toString()).toBe(WORDS);
    clear();
    expect(del).toHaveBeenCalledWith(HIGHLIGHT_NAME);
  });

  it("does nothing where the browser has no highlight support", () => {
    vi.stubGlobal("CSS", {});
    expect(() => applyHighlights(cards(), [mine()])()).not.toThrow();
  });
});

describe("your comments under the feedback box", () => {
  const show = (saved: DebriefMyComment[], enabled = true) => {
    const ref = createRef<HTMLDivElement>();
    return render(
      <SelectionCommentsProvider enabled={enabled} saved={saved}>
        <div ref={ref}>
          <SelectionCommentPopup containerRef={ref} />
        </div>
        <SelectionFeedbackComposer sessionId="s1" />
      </SelectionCommentsProvider>,
    );
  };

  it("lists what was sent, with the words, or says it was on the whole debrief", () => {
    show([
      mine(),
      mine({
        id: "c2",
        section: null,
        quotedText: null,
        spanStart: null,
        spanEnd: null,
        body: "Helpful.",
      }),
    ]);
    const items = screen.getAllByTestId("selection-feedback-saved-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(`“${WORDS}”`);
    expect(items[0]).toHaveTextContent("Exactly what I needed.");
    expect(items[1]).toHaveTextContent("postSim.debriefCards.selectionComments.onWholeDebrief");
    expect(items[1]).toHaveTextContent("Helpful.");
  });

  it("shows no list when nothing was sent, and nothing at all without the feature", () => {
    const { unmount } = show([]);
    expect(screen.queryByTestId("selection-feedback-saved")).not.toBeInTheDocument();
    unmount();
    show([mine()], false);
    expect(screen.queryByTestId("selection-feedback")).not.toBeInTheDocument();
  });
});
