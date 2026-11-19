import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { selectionToAnchor } from "../selectionAnchor";
import {
  SelectionCommentPopup,
  SelectionCommentsProvider,
  SelectionFeedbackComposer,
} from "../SelectionComments";

const mockSend = vi.fn();
vi.mock("@api", () => ({
  useAddDebriefCommentsMutation: () => [mockSend, { isLoading: false }],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
  }),
}));

const BODY = "You named it plainly instead of moving on. That gave her room.";
const WORDS = "named it plainly instead of moving on";

/** A card with one selectable line, as the debrief renders it. */
const Cards = ({ enabled = true }: { enabled?: boolean }) => {
  const ref = createRef<HTMLDivElement>();
  return (
    <SelectionCommentsProvider enabled={enabled}>
      <div ref={ref} data-testid="cards" style={{ position: "relative" }}>
        <p data-testid="line" data-anchor="card:what_worked[0].body">
          {BODY}
        </p>
        <p data-testid="plain">Not a card field.</p>
        <SelectionCommentPopup containerRef={ref} />
      </div>
      <SelectionFeedbackComposer sessionId="s1" />
    </SelectionCommentsProvider>
  );
};

const select = (testId: string, from: number, to: number) => {
  const text = screen.getByTestId(testId).firstChild as Text;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  range.getBoundingClientRect = () =>
    ({ left: 10, right: 100, top: 20, bottom: 40, width: 90, height: 20 }) as DOMRect;
};

const choose = async (testId: string, from: number, to: number) => {
  select(testId, from, to);
  fireEvent.mouseUp(screen.getByTestId("cards"));
  return screen.findByTestId("selection-comment-popup");
};

describe("the selection becomes a card anchor", () => {
  it("counts the offsets in the line's own text and trims spaces", () => {
    render(<Cards />);
    const start = BODY.indexOf(WORDS);
    select("line", start - 1, start + WORDS.length);
    const found = selectionToAnchor(window.getSelection(), screen.getByTestId("cards"));
    expect(found?.anchor).toEqual({
      section: "what_worked[0].body",
      spanStart: start,
      spanEnd: start + WORDS.length,
      quotedText: WORDS,
    });
  });

  it("counts a quote's offsets without its quotation marks", () => {
    render(
      <div data-testid="cards">
        <blockquote>
          <span data-anchor="card:important_moment.quote" data-anchor-wrap="1">
            “I feel out of place.”
          </span>
        </blockquote>
      </div>,
    );
    const text = screen.getByText(/I feel out of place/).firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const found = selectionToAnchor(window.getSelection(), screen.getByTestId("cards"));
    expect(found?.anchor).toEqual({
      section: "important_moment.quote",
      spanStart: 0,
      spanEnd: "I feel out of place.".length,
      quotedText: "I feel out of place.",
    });
  });

  it("is nothing outside a card field, when empty, or when it runs too long", () => {
    render(<Cards />);
    select("plain", 0, 8);
    expect(selectionToAnchor(window.getSelection(), screen.getByTestId("cards"))).toBeNull();
    window.getSelection()!.removeAllRanges();
    expect(selectionToAnchor(window.getSelection(), screen.getByTestId("cards"))).toBeNull();
    const long = document.createElement("p");
    long.setAttribute("data-anchor", "card:opening");
    long.textContent = "x".repeat(400);
    screen.getByTestId("cards").appendChild(long);
    const range = document.createRange();
    range.selectNodeContents(long);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(selectionToAnchor(window.getSelection(), screen.getByTestId("cards"))).toBeNull();
  });
});

describe("select, add, and send together", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockReturnValue({ unwrap: () => Promise.resolve({ saved: 2 }) });
    window.getSelection()?.removeAllRanges();
  });

  it("adds the comment to the feedback box, nothing is sent until Send", async () => {
    render(<Cards />);
    const start = BODY.indexOf(WORDS);
    const popup = await choose("line", start, start + WORDS.length);
    expect(popup).toHaveTextContent(`“${WORDS}”`);
    fireEvent.change(within(popup).getByRole("textbox"), {
      target: { value: "Exactly what I needed." },
    });
    fireEvent.click(within(popup).getByRole("button"));
    expect(screen.queryByTestId("selection-comment-popup")).not.toBeInTheDocument();
    const chip = screen.getByTestId("selection-feedback-chip");
    expect(chip).toHaveTextContent(WORDS);
    expect(chip).toHaveTextContent("Exactly what I needed.");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("will not add an empty comment", async () => {
    render(<Cards />);
    const start = BODY.indexOf(WORDS);
    const popup = await choose("line", start, start + WORDS.length);
    fireEvent.click(within(popup).getByRole("button"));
    expect(screen.getByRole("alert")).toHaveTextContent("needText");
    expect(screen.queryByTestId("selection-feedback-chip")).not.toBeInTheDocument();
  });

  it("sends every comment and the overall one in one call, then clears", async () => {
    render(<Cards />);
    const start = BODY.indexOf(WORDS);
    const popup = await choose("line", start, start + WORDS.length);
    fireEvent.change(within(popup).getByRole("textbox"), { target: { value: "Great." } });
    fireEvent.click(within(popup).getByRole("button"));
    fireEvent.change(screen.getByLabelText("postSim.debriefCards.selectionComments.overallLabel"), {
      target: { value: "Helpful overall." },
    });
    fireEvent.click(screen.getByTestId("selection-feedback-send"));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith({
      sessionId: "s1",
      overall: "Helpful overall.",
      items: [
        {
          section: "what_worked[0].body",
          spanStart: start,
          spanEnd: start + WORDS.length,
          quotedText: WORDS,
          body: "Great.",
        },
      ],
    });
    await waitFor(() =>
      expect(screen.queryByTestId("selection-feedback-chip")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("postSim.debrief.feedback.thankYou");
  });

  it("lets the learner send only an overall comment, and shows a failure without losing anything", async () => {
    mockSend.mockReturnValue({ unwrap: () => Promise.reject(new Error("down")) });
    render(<Cards />);
    expect(screen.getByTestId("selection-feedback-send")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("postSim.debriefCards.selectionComments.overallLabel"), {
      target: { value: "Just this." },
    });
    fireEvent.click(screen.getByTestId("selection-feedback-send"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("saveFailed"));
    expect(mockSend).toHaveBeenCalledWith({ sessionId: "s1", overall: "Just this.", items: [] });
    expect(
      screen.getByLabelText("postSim.debriefCards.selectionComments.overallLabel"),
    ).toHaveValue("Just this.");
  });

  it("removes a chip", async () => {
    render(<Cards />);
    const start = BODY.indexOf(WORDS);
    const popup = await choose("line", start, start + WORDS.length);
    fireEvent.change(within(popup).getByRole("textbox"), { target: { value: "Hm." } });
    fireEvent.click(within(popup).getByRole("button"));
    fireEvent.click(screen.getByLabelText("postSim.debriefCards.selectionComments.remove"));
    expect(screen.queryByTestId("selection-feedback-chip")).not.toBeInTheDocument();
  });

  it("does nothing for a person without the feature: no popup, no box", async () => {
    render(<Cards enabled={false} />);
    const start = BODY.indexOf(WORDS);
    select("line", start, start + WORDS.length);
    fireEvent.mouseUp(screen.getByTestId("cards"));
    await new Promise(r => setTimeout(r, 10));
    expect(screen.queryByTestId("selection-comment-popup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selection-feedback")).not.toBeInTheDocument();
  });
});
