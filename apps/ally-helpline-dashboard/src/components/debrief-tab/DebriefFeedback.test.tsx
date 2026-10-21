import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

import { DebriefFeedback } from "./DebriefFeedback";

const mockSubmitDebriefFeedback = vi.fn();
vi.mock("@api", () => ({
  useSubmitDebriefFeedbackMutation: () => [mockSubmitDebriefFeedback, { isLoading: false }],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@assets", () => ({
  ThumbUp: () => <div data-testid="thumb-up" />,
  ThumbUpFilled: () => <div data-testid="thumb-up-filled" />,
  ThumbDown: () => <div data-testid="thumb-down" />,
  ThumbDownFilled: () => <div data-testid="thumb-down-filled" />,
  SendArrow: () => <div data-testid="send-arrow" />,
}));

describe("DebriefFeedback", () => {
  const sessionId = "test-session-123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitDebriefFeedback.mockReturnValue({ unwrap: () => Promise.resolve() });
  });

  it("renders 'Was this helpful?' prompt with two icon buttons", () => {
    render(<DebriefFeedback sessionId={sessionId} />);

    expect(screen.getByText("postSim.debrief.feedback.question")).toBeInTheDocument();
    expect(screen.getByLabelText("Thumbs up")).toBeInTheDocument();
    expect(screen.getByLabelText("Thumbs down")).toBeInTheDocument();
  });

  it("clicking a button calls the feedback submission API and transitions the component to the 'voted' state", async () => {
    const user = userEvent.setup();
    render(<DebriefFeedback sessionId={sessionId} />);

    await user.click(screen.getByLabelText("Thumbs up"));

    expect(mockSubmitDebriefFeedback).toHaveBeenCalledWith({
      sessionId,
      rating: "positive",
    });

    expect(screen.getByTestId("thumb-up-filled")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("postSim.debrief.feedback.commentPlaceholder"),
    ).toBeInTheDocument();
  });

  it("after clicking a rating button, a text input and submit button appear", async () => {
    const user = userEvent.setup();
    render(<DebriefFeedback sessionId={sessionId} />);

    await user.click(screen.getByLabelText("Thumbs down"));

    expect(
      screen.getByPlaceholderText("postSim.debrief.feedback.commentPlaceholder"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /common.submit/i })).toBeInTheDocument();
  });

  it("entering text and clicking submit calls the feedback submission API with the comment and shows thank you state", async () => {
    const user = userEvent.setup();
    render(<DebriefFeedback sessionId={sessionId} />);

    await user.click(screen.getByLabelText("Thumbs up"));

    const comment = "This was really specific and helpful.";
    await user.type(
      screen.getByPlaceholderText("postSim.debrief.feedback.commentPlaceholder"),
      comment,
    );
    await user.click(screen.getByRole("button", { name: /common.submit/i }));

    expect(mockSubmitDebriefFeedback).toHaveBeenLastCalledWith({
      sessionId,
      rating: "positive",
      comment,
    });

    await waitFor(() => {
      expect(screen.getByText("postSim.debrief.feedback.thankYou")).toBeInTheDocument();
    });
    expect(
      screen.queryByPlaceholderText("postSim.debrief.feedback.commentPlaceholder"),
    ).not.toBeInTheDocument();
  });
});
