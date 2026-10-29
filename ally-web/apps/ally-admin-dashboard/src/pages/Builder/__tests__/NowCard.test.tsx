import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderDecision } from "@types";

import { NowCard } from "../room/NowCard";
import { ARMING_DELAY_MS } from "../room/roomFormat";

const NOW = Date.parse("2026-10-29T12:00:00Z");

const decision = (over: Partial<BuilderDecision> = {}): BuilderDecision =>
  ({
    id: "question:s1:q1",
    kind: "question",
    category: "what",
    sessionId: "s1",
    sessionTitle: "Rate the debrief",
    sessionStatus: "INTERVIEWING",
    createdByName: null,
    repos: [],
    prompt: "Where should a learner rate the debrief?",
    rationale: "Learners read top to bottom.\nBased on: scroll depth",
    questionType: null,
    context: ["62% reach the end"],
    blocked: "The PRD's feedback section.",
    selection: "single",
    options: [
      { id: "end", label: "At the end", recommended: true },
      { id: "modal", label: "In a pop-up" },
    ],
    allowCustom: true,
    allowNone: false,
    minSelections: null,
    customPlaceholder: null,
    waitingSince: new Date(NOW - 12 * 60_000).toISOString(),
    pullRequestUrl: null,
    ...over,
  }) as BuilderDecision;

const merge = () =>
  decision({
    id: "pr_merge:s1:pr1",
    kind: "pr_merge",
    prompt: "Merge #61?",
    options: [
      {
        id: "merge",
        label: "Merge #61",
        recommended: true,
        oneWay: true,
        confirm: true,
        consequence: "Merges #61 to master.",
      },
    ],
    allowCustom: false,
  });

const renderCard = (props: Partial<React.ComponentProps<typeof NowCard>> = {}) => {
  const onSend = vi.fn();
  const onLater = vi.fn();
  render(
    <NowCard
      decision={decision()}
      sessionLabel="OPP-0828"
      now={NOW}
      active
      showKeys
      compact={false}
      followUp={false}
      elsewhere={null}
      error={null}
      disabled={false}
      canPutBack={false}
      onSend={onSend}
      onLater={onLater}
      onOpenSession={vi.fn()}
      onPutBack={vi.fn()}
      onRetry={vi.fn()}
      {...props}
    />,
  );
  return { onSend, onLater };
};

describe("NowCard", () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("puts the question first and sends a reversible option on one click", () => {
    const { onSend } = renderCard();
    expect(
      screen.getByRole("heading", { name: "Where should a learner rate the debrief?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /In a pop-up/ }));
    expect(onSend).toHaveBeenCalledWith({ selectedOptionIds: ["modal"] }, "In a pop-up", false);
  });

  it("picks on a digit and sends on the same digit again", () => {
    const { onSend } = renderCard();
    fireEvent.keyDown(window, { key: "2" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "2" });
    expect(onSend).toHaveBeenLastCalledWith({ selectedOptionIds: ["modal"] }, "In a pop-up", false);
  });

  it("sends the recommendation on Enter", () => {
    const { onSend } = renderCard();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSend).toHaveBeenLastCalledWith({ selectedOptionIds: ["end"] }, "At the end", false);
  });

  it("arms a one-way option, shows its consequence, and ignores a second press inside the delay", () => {
    const { onSend } = renderCard({ decision: merge() });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("Merges #61 to master.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    vi.setSystemTime(NOW + ARMING_DELAY_MS + 1);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ selectedOptionIds: ["merge"] }, "Merge #61", true);
  });

  it("disarms on scroll, so a tap ending a scroll can't merge", () => {
    const { onSend } = renderCard({ decision: merge() });
    fireEvent.click(screen.getByRole("button", { name: /Merge #61/ }));
    expect(screen.getByText("Merges #61 to master.")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByText("Merges #61 to master.")).not.toBeInTheDocument();
    vi.setSystemTime(NOW + ARMING_DELAY_MS + 1);
    fireEvent.click(screen.getByRole("button", { name: /Merge #61/ }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("collapses the rationale on a phone and hides key hints without a fine pointer", () => {
    renderCard({ compact: true, showKeys: false });
    expect(screen.getByRole("button", { name: /Why I'm asking/ })).toBeInTheDocument();
    expect(screen.queryByText("Learners read top to bottom.")).not.toBeInTheDocument();
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("offers Later and says when it was decided elsewhere", () => {
    const { onLater, onSend } = renderCard({ elsewhere: "" });
    expect(screen.getByRole("status")).toHaveTextContent("Decided elsewhere.");
    fireEvent.click(screen.getByRole("button", { name: /In a pop-up/ }));
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Later/ }));
    expect(onLater).toHaveBeenCalled();
  });
});
