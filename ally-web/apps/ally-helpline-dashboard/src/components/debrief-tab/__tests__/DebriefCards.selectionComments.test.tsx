import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { LearnerDebriefView } from "@types";

import { DebriefCards } from "../DebriefCards";

const mockSend = vi.fn();
vi.mock("../useDebriefReadAloud", () => ({ useDebriefReadAloud: () => null }));
vi.mock("@api", () => ({
  useReportDebriefEventMutation: () => [vi.fn(() => ({ unwrap: () => Promise.resolve() }))],
  useMarkDebriefOpenedMutation: () => [vi.fn()],
  useMarkDebriefReadMutation: () => [vi.fn()],
  useSetDebriefHelpfulMutation: () => [vi.fn(), { isLoading: false }],
  useAnswerDebriefPulseMutation: () => [vi.fn(), { isLoading: false }],
  useFlagDebriefCardMutation: () => [vi.fn(), { isLoading: false }],
  useUndoDebriefFlagMutation: () => [vi.fn(), { isLoading: false }],
  useLazyGetDebriefCardAudioQuery: () => [vi.fn()],
  useAddDebriefCommentsMutation: () => [mockSend, { isLoading: false }],
}));

const WHY = "You moved on before she could say more about feeling out of place.";
const QUOTE = "Okay, what are you feeling";
const CARDS = {
  opening: "You asked how she was and she opened up a little.",
  important_moment: null,
  what_worked: [
    { turn_index: 9, lead: "Asking directly", quote: "Are you lonely?", body: "You named it." },
  ],
  work_on_this: [
    {
      turn_index: 8,
      lead: "Staying with a feeling",
      quote: QUOTE,
      why: WHY,
      try_saying: "That sounds lonely. Tell me more.",
    },
  ],
  practise_next: null,
  skill_words: [],
  reflective_question: "What would you say next time?",
  progress_note: null,
} as unknown as NonNullable<LearnerDebriefView["cards"]>;

const view = (features?: LearnerDebriefView["features"]): LearnerDebriefView => ({
  state: "ready",
  runId: "r1",
  language: "en-IN",
  cards: CARDS,
  features,
});

const renderCards = (v: LearnerDebriefView) =>
  render(
    <MemoryRouter>
      <DebriefCards view={v} sessionId="s1" />
    </MemoryRouter>,
  );

const selectWords = (el: HTMLElement, words: string) => {
  const text = el.firstChild as Text;
  const start = (text.textContent ?? "").indexOf(words);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + words.length);
  range.getBoundingClientRect = () =>
    ({ left: 10, right: 90, top: 10, bottom: 30, width: 80, height: 20 }) as DOMRect;
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  return start;
};

describe("select-and-comment in the real debrief", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockReturnValue({ unwrap: () => Promise.resolve({ saved: 1 }) });
    window.getSelection()?.removeAllRanges();
  });

  it("marks every card line a learner can select with the section the server checks", () => {
    renderCards(view({ selectionComments: true }));
    const anchors = [...document.querySelectorAll("[data-anchor]")].map(e =>
      e.getAttribute("data-anchor"),
    );
    expect(anchors).toEqual(
      expect.arrayContaining([
        "card:opening",
        "card:what_worked[0].lead",
        "card:what_worked[0].quote",
        "card:what_worked[0].body",
        "card:work_on_this[0].lead",
        "card:work_on_this[0].quote",
        "card:work_on_this[0].why",
        "card:work_on_this[0].try_saying",
        "card:reflective_question",
      ]),
    );
  });

  it("sends a comment on selected words with the exact span, from the box under the debrief", async () => {
    renderCards(view({ selectionComments: true }));
    const line = document.querySelector<HTMLElement>('[data-anchor="card:work_on_this[0].why"]')!;
    const start = selectWords(line, "before she could say more");
    fireEvent.mouseUp(screen.getByTestId("debrief-cards"));
    const popup = await screen.findByTestId("selection-comment-popup");
    fireEvent.change(within(popup).getByRole("textbox"), { target: { value: "Fair point." } });
    fireEvent.click(within(popup).getByRole("button"));
    fireEvent.click(screen.getByTestId("selection-feedback-send"));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith({
      sessionId: "s1",
      overall: undefined,
      items: [
        {
          section: "work_on_this[0].why",
          spanStart: start,
          spanEnd: start + "before she could say more".length,
          quotedText: "before she could say more",
          body: "Fair point.",
        },
      ],
    });
  });

  it("changes nothing for a learner without the feature", async () => {
    renderCards(view({ selectionComments: false }));
    const line = document.querySelector<HTMLElement>('[data-anchor="card:work_on_this[0].why"]')!;
    selectWords(line, "before she could say more");
    fireEvent.mouseUp(screen.getByTestId("debrief-cards"));
    await new Promise(r => setTimeout(r, 10));
    expect(screen.queryByTestId("selection-comment-popup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selection-feedback")).not.toBeInTheDocument();
    expect(screen.getByTestId("debrief-helpful")).toBeInTheDocument();
  });

  it("changes nothing for a supervisor reading someone else's debrief", () => {
    render(
      <MemoryRouter>
        <DebriefCards view={view({ selectionComments: true })} sessionId="s1" supervisor={{}} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("selection-feedback")).not.toBeInTheDocument();
  });
});
