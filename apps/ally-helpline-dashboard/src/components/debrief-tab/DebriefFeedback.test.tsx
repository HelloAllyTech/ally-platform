import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

import type { SubmitDebriefFeedbackRequest } from "@types";

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

/**
 * Behaves like POST /v1/scenario-sessions/:sessionId/debrief-feedback: one row
 * per session, created by the first post; a later post adds its comment to
 * that row and keeps the first rating. `failNextPost` makes the next post
 * reject the way the endpoint did before it accepted a second post (409).
 */
const createFeedbackEndpoint = () => {
  const rows = new Map<string, { rating: string; comment?: string }>();
  let failures = 0;
  const submit = (request: SubmitDebriefFeedbackRequest) => ({
    unwrap: () => {
      if (failures > 0) {
        failures -= 1;
        return Promise.reject({
          status: 409,
          data: { message: "Feedback for this session already exists" },
        });
      }
      const existing = rows.get(request.sessionId);
      const row = existing
        ? { ...existing, ...(request.comment ? { comment: request.comment } : {}) }
        : { rating: request.rating, comment: request.comment };
      rows.set(request.sessionId, row);
      return Promise.resolve({ id: "f-1", scenarioSessionId: request.sessionId, ...row });
    },
  });
  return {
    rows,
    submit,
    failNextPost: () => {
      failures += 1;
    },
  };
};

describe("DebriefFeedback", () => {
  const sessionId = "test-session-123";
  let endpoint: ReturnType<typeof createFeedbackEndpoint>;

  beforeEach(() => {
    vi.clearAllMocks();
    endpoint = createFeedbackEndpoint();
    mockSubmitDebriefFeedback.mockImplementation(endpoint.submit);
  });

  const commentBox = () =>
    screen.queryByPlaceholderText("postSim.debrief.feedback.commentPlaceholder");

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

  it("saves the rating, then the comment, then thanks the learner", async () => {
    const user = userEvent.setup();
    render(<DebriefFeedback sessionId={sessionId} />);

    await user.click(screen.getByLabelText("Thumbs down"));
    await user.type(commentBox()!, "  Too generic to act on.  ");
    await user.click(screen.getByRole("button", { name: /common.submit/i }));

    expect(mockSubmitDebriefFeedback).toHaveBeenCalledTimes(2);
    expect(mockSubmitDebriefFeedback).toHaveBeenNthCalledWith(1, {
      sessionId,
      rating: "negative",
    });
    expect(mockSubmitDebriefFeedback).toHaveBeenNthCalledWith(2, {
      sessionId,
      rating: "negative",
      comment: "Too generic to act on.",
    });
    expect(endpoint.rows.get(sessionId)).toEqual({
      rating: "negative",
      comment: "Too generic to act on.",
    });

    await waitFor(() => expect(commentBox()).not.toBeInTheDocument());
    expect(screen.getByText("postSim.debrief.feedback.thankYou")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends no comment field when the box is left blank", async () => {
    const user = userEvent.setup();
    render(<DebriefFeedback sessionId={sessionId} />);

    await user.click(screen.getByLabelText("Thumbs up"));
    await user.type(commentBox()!, "   ");
    await user.click(screen.getByRole("button", { name: /common.submit/i }));

    expect(mockSubmitDebriefFeedback).toHaveBeenLastCalledWith({ sessionId, rating: "positive" });
    await waitFor(() => expect(commentBox()).not.toBeInTheDocument());
  });

  it("says the comment didn't save, keeps it, and Retry resends it", async () => {
    const user = userEvent.setup();
    render(<DebriefFeedback sessionId={sessionId} />);

    await user.click(screen.getByLabelText("Thumbs up"));
    await user.type(commentBox()!, "Clear next steps.");
    endpoint.failNextPost();
    await user.click(screen.getByRole("button", { name: /common.submit/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "postSim.debrief.feedback.saveFailed",
    );
    expect(commentBox()).toHaveValue("Clear next steps.");
    expect(endpoint.rows.get(sessionId)?.comment).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "common.retry" }));

    await waitFor(() => expect(commentBox()).not.toBeInTheDocument());
    expect(endpoint.rows.get(sessionId)).toEqual({
      rating: "positive",
      comment: "Clear next steps.",
    });
  });

  it("says the rating didn't save and Retry resends the rating", async () => {
    const user = userEvent.setup();
    render(<DebriefFeedback sessionId={sessionId} />);

    endpoint.failNextPost();
    await user.click(screen.getByLabelText("Thumbs down"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "postSim.debrief.feedback.saveFailed",
    );
    // Not thanked for a rating that didn't save.
    expect(screen.getByText("postSim.debrief.feedback.question")).toBeInTheDocument();
    expect(endpoint.rows.has(sessionId)).toBe(false);

    await user.click(screen.getByRole("button", { name: "common.retry" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mockSubmitDebriefFeedback).toHaveBeenLastCalledWith({ sessionId, rating: "negative" });
    expect(endpoint.rows.get(sessionId)).toEqual({ rating: "negative", comment: undefined });
    expect(screen.getByText("postSim.debrief.feedback.thankYou")).toBeInTheDocument();
    expect(commentBox()).toBeInTheDocument();
  });
});
