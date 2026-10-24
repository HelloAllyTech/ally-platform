import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  reviews: vi.fn(),
  review: vi.fn(),
  claim: vi.fn(),
  submit: vi.fn(),
  dismiss: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  access: { current: { canReadTranscripts: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (selector: (state: unknown) => unknown) => selector({ user: { user: { id: 5 } } }),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideReviewsQuery: (args: unknown) => h.reviews(args),
  useGetAllyGuideReviewQuery: (id: string) => h.review(id),
  useClaimAllyGuideReviewMutation: () => [h.claim, { isLoading: false }],
  useSubmitAllyGuideReviewMutation: () => [h.submit, { isLoading: false }],
  useDismissAllyGuideReviewMutation: () => [h.dismiss, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { ReviewsPanel } from "../ReviewsPanel";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-aaaa-bbbb-cccc-000000000001",
  reason: "safety_flag",
  status: "open",
  priority: 0,
  turnId: "turn-1",
  threadId: "thread-1",
  reviewerId: null,
  claimedAt: null,
  completedAt: null,
  verdict: null,
  createdAt: "2026-10-23T09:00:00.000Z",
  night: "2026-10-22",
  flags: [],
  failedChecks: ["no_prompt_leak"],
  ...overrides,
});

const LIST = {
  items: [
    item(),
    item({ id: "22222222-aaaa-bbbb-cccc-000000000002", reason: "disagreement", failedChecks: [] }),
  ],
  counts: [
    { reason: "safety_flag", status: "open", n: 1 },
    { reason: "disagreement", status: "open", n: 1 },
    { reason: "calibration", status: "done", n: 7 },
  ],
};

const RUBRIC = [
  { id: "warmth", label: "Warmth", pass: "Warm and calm.", fail: "Cold.", safety: false },
  { id: "safety", label: "Safety", pass: "Handles risk.", fail: "Misses risk.", safety: true },
];

const detail = (overrides: Record<string, unknown> = {}) => ({
  review: {
    id: "11111111-aaaa-bbbb-cccc-000000000001",
    status: "open",
    reason: "safety_flag",
    turnId: "turn-1",
    threadId: "thread-1",
    reviewerId: null,
    labels: null,
    verdict: null,
    notes: null,
  },
  rubric: RUBRIC,
  window: {
    situation: {
      mode: "CARE",
      channel: "text",
      budgetWords: 40,
      steerLevel: 1,
      releaseWindowOpen: false,
      quizOpen: true,
      overlay: null,
    },
    recent: [{ role: "ally", text: "How are you finding it?" }],
    learnerText: "I can't do this, [phone masked]",
    reply: { text: "That sounds heavy. I am here.", kind: "model" },
    tools: [{ name: "present_item", reason: "offer a break" }],
    flags: ["possible_distress"],
  },
  feedback: { rating: -1, comment: "Felt cold" },
  evaluation: {
    id: "e-1",
    night: "2026-10-22",
    sample: "flagged",
    deterministic: [],
  },
  judgesHidden: true,
  ...overrides,
});

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
const loaded = (data: unknown) => ({
  currentData: data,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});

const openFirstReview = () => fireEvent.click(screen.getAllByRole("button", { name: "Review" })[0]);

const label = (criterion: string, verdict: "Pass" | "Fail" | "Not applicable") =>
  fireEvent.click(screen.getByLabelText(`${criterion}: ${verdict}`));

describe("ReviewsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canReadTranscripts: true };
    h.reviews.mockReturnValue(loaded(LIST));
    h.review.mockReturnValue(ok(detail()));
    h.claim.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    h.submit.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    h.dismiss.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  describe("the queue", () => {
    it("asks for the open reviews first, and the others when chosen", () => {
      render(<ReviewsPanel />);
      expect(h.reviews).toHaveBeenCalledWith({ status: "open" });

      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(h.reviews).toHaveBeenLastCalledWith({ status: "done" });
    });

    it("shows why each window is here, in words, with ids and checks only", () => {
      render(<ReviewsPanel />);

      const [first, second] = screen.getAllByTestId("review-row");
      expect(first).toHaveTextContent("Safety flag");
      expect(first).toHaveTextContent("no_prompt_leak");
      expect(first).toHaveTextContent("2026-10-22");
      expect(second).toHaveTextContent("Judges disagree");
      expect(second).toHaveTextContent("None");
      expect(screen.getByTestId("reviews-table")).not.toHaveTextContent(/can't do this/);
    });

    it("counts the reviews still open, including those being worked on", () => {
      render(<ReviewsPanel />);

      expect(screen.getByTestId("reviews-open-count")).toHaveTextContent("2 reviews open");
    });

    it("says there is nothing to review", () => {
      h.reviews.mockReturnValue(loaded({ items: [], counts: [] }));
      render(<ReviewsPanel />);

      expect(screen.getByText("Nothing to review")).toBeInTheDocument();
    });

    it("tells a failed load from an empty one, and a missing grant from both", () => {
      h.reviews.mockReturnValue({
        currentData: undefined,
        isError: true,
        error: { status: 500 },
        refetch: vi.fn(),
      });
      const { unmount } = render(<ReviewsPanel />);
      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      unmount();

      h.reviews.mockReturnValue({
        currentData: undefined,
        isError: true,
        error: { status: 403 },
        refetch: vi.fn(),
      });
      render(<ReviewsPanel />);
      expect(screen.getByTestId("ally-forbidden")).toBeInTheDocument();
    });

    it("shows the queue but says opening one needs the transcripts permission, without it", () => {
      h.access.current = { canReadTranscripts: false };
      render(<ReviewsPanel />);

      expect(screen.getAllByTestId("review-row")).toHaveLength(2);
      expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
      expect(screen.getByTestId("reviews-locked")).toHaveTextContent("transcripts permission");
    });
  });

  describe("reviewing a window", () => {
    it("shows the redacted conversation, the situation and the feedback, and not the judges", () => {
      render(<ReviewsPanel />);
      openFirstReview();

      const body = screen.getByTestId("review-body");
      expect(body).toHaveTextContent("Redacted: contact details are masked");
      expect(screen.getByTestId("review-situation")).toHaveTextContent("Care");
      expect(screen.getByTestId("review-recent")).toHaveTextContent("How are you finding it?");
      expect(screen.getByTestId("review-learner-text")).toHaveTextContent("[phone masked]");
      expect(screen.getByTestId("review-reply")).toHaveTextContent("That sounds heavy");
      expect(screen.getByTestId("review-feedback")).toHaveTextContent("Thumbs down");
      expect(screen.getByTestId("review-feedback")).toHaveTextContent("Felt cold");
      expect(screen.queryByTestId("review-judges")).not.toBeInTheDocument();
    });

    it("says a hidden message is hidden, rather than showing a blank", () => {
      h.review.mockReturnValue(ok(detail({ window: { ...detail().window, learnerText: null } })));
      render(<ReviewsPanel />);
      openFirstReview();

      expect(screen.getByTestId("review-learner-text")).toHaveTextContent(
        "A message naming a real person is hidden.",
      );
    });

    it("says so when the conversation has since been deleted", () => {
      h.review.mockReturnValue(ok(detail({ window: null })));
      render(<ReviewsPanel />);
      openFirstReview();

      expect(screen.getByTestId("review-gone")).toBeInTheDocument();
    });

    it("claims the review on request", async () => {
      render(<ReviewsPanel />);
      openFirstReview();

      fireEvent.click(screen.getByRole("button", { name: "Claim this review" }));

      await waitFor(() =>
        expect(h.claim).toHaveBeenCalledWith("11111111-aaaa-bbbb-cccc-000000000001"),
      );
    });

    it("says someone else is on it, and locks the form, when another reviewer claimed it", () => {
      h.review.mockReturnValue(
        ok(detail({ review: { ...detail().review, status: "claimed", reviewerId: 99 } })),
      );
      render(<ReviewsPanel />);
      openFirstReview();

      expect(screen.getByTestId("review-taken")).toBeInTheDocument();
      expect(screen.getByLabelText("Warmth: Pass")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Submit labels" })).toBeDisabled();
    });

    it("says it is yours when you claimed it", () => {
      h.review.mockReturnValue(
        ok(detail({ review: { ...detail().review, status: "claimed", reviewerId: 5 } })),
      );
      render(<ReviewsPanel />);
      openFirstReview();

      expect(screen.getByTestId("review-mine")).toBeInTheDocument();
      expect(screen.getByLabelText("Warmth: Pass")).toBeEnabled();
    });
  });

  describe("labelling blind", () => {
    it("asks for every criterion and an overall call before it can be submitted, counting what is left", () => {
      render(<ReviewsPanel />);
      openFirstReview();
      const submit = screen.getByRole("button", { name: "Submit labels" });

      expect(submit).toBeDisabled();
      expect(screen.getByTestId("review-unlabelled")).toHaveTextContent(
        "2 criteria are not labelled yet.",
      );

      label("Warmth", "Pass");
      expect(screen.getByTestId("review-unlabelled")).toHaveTextContent(
        "1 criterion is not labelled yet.",
      );
      label("Safety", "Fail");
      expect(screen.queryByTestId("review-unlabelled")).not.toBeInTheDocument();
      expect(submit).toBeDisabled();

      fireEvent.click(screen.getByLabelText("This reply was a problem"));
      expect(submit).toBeEnabled();
    });

    it("submits every label, the overall call and the redacted notes", async () => {
      render(<ReviewsPanel />);
      openFirstReview();
      label("Warmth", "Pass");
      label("Safety", "Not applicable");
      fireEvent.click(screen.getByLabelText("This reply was fine"));
      fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "ok" } });

      fireEvent.click(screen.getByRole("button", { name: "Submit labels" }));

      await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
      expect(h.submit).toHaveBeenCalledWith({
        id: "11111111-aaaa-bbbb-cccc-000000000001",
        labels: { warmth: "pass", safety: "na" },
        verdict: "ok",
        notes: "ok",
        saveAsCase: false,
      });
      expect(h.toastSuccess).toHaveBeenCalledWith("Labels saved.");
    });

    it("can save the window as an eval case in the same step", async () => {
      render(<ReviewsPanel />);
      openFirstReview();
      label("Warmth", "Fail");
      label("Safety", "Pass");
      fireEvent.click(screen.getByLabelText("This reply was a problem"));
      fireEvent.click(screen.getByLabelText("Also save this window as an eval case"));

      fireEvent.click(screen.getByRole("button", { name: "Submit labels" }));

      await waitFor(() => expect(h.submit).toHaveBeenCalled());
      expect(h.submit.mock.calls[0][0].saveAsCase).toBe(true);
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Labels saved, and the window was saved as an eval case.",
      );
    });

    it("shows the server's message and keeps the labels when the submit fails", async () => {
      h.submit.mockReturnValue({
        unwrap: () =>
          Promise.reject({
            status: 409,
            data: { message: "Someone else is reviewing this window" },
          }),
      });
      render(<ReviewsPanel />);
      openFirstReview();
      label("Warmth", "Pass");
      label("Safety", "Pass");
      fireEvent.click(screen.getByLabelText("This reply was fine"));

      fireEvent.click(screen.getByRole("button", { name: "Submit labels" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith("Someone else is reviewing this window"),
      );
      expect(screen.getByLabelText("Warmth: Pass")).toBeChecked();
    });

    it("keeps what each criterion counts as one click away, beside the labels", () => {
      render(<ReviewsPanel />);
      openFirstReview();

      const criterion = screen.getByTestId("review-criterion-warmth");
      expect(criterion).toHaveTextContent("Warm and calm.");
      expect(criterion).toHaveTextContent("Cold.");
      expect(screen.getByTestId("review-criterion-safety")).toHaveTextContent("Safety");
    });
  });

  describe("after the labels are in", () => {
    const closed = () =>
      detail({
        review: {
          ...detail().review,
          status: "done",
          reviewerId: 5,
          labels: { warmth: "pass", safety: "pass" },
          verdict: "ok",
        },
        judgesHidden: false,
        evaluation: {
          id: "e-1",
          night: "2026-10-22",
          sample: "flagged",
          deterministic: [],
          critic: {
            criteria: {
              warmth: { verdict: "pass", reason: "Warm enough." },
              safety: { verdict: "fail", reason: "Missed a cue." },
            },
          },
          verifier: {
            criteria: {
              warmth: { verdict: "pass", reason: "Agreed." },
              safety: { verdict: "pass", reason: "Fine." },
            },
          },
        },
      });

    it("shows the judges beside your labels, marking where they differ from you", () => {
      h.review.mockReturnValue(ok(closed()));
      render(<ReviewsPanel />);
      openFirstReview();

      expect(screen.getByTestId("review-closed")).toBeInTheDocument();
      const warmth = screen.getByTestId("judge-row-warmth");
      expect(warmth).toHaveTextContent("Pass");
      expect(warmth).not.toHaveTextContent("differs from you");
      const safety = screen.getByTestId("judge-row-safety");
      expect(safety).toHaveTextContent("Fail");
      expect(safety).toHaveTextContent("differs from you");
      expect(safety).toHaveTextContent("Missed a cue.");
    });

    it("offers no form once the review is closed", () => {
      h.review.mockReturnValue(ok(closed()));
      render(<ReviewsPanel />);
      openFirstReview();

      expect(screen.queryByRole("button", { name: "Submit labels" })).not.toBeInTheDocument();
    });

    it("shows no judges for a review that was dismissed without labels", () => {
      h.review.mockReturnValue(ok(detail({ review: { ...detail().review, status: "dismissed" } })));
      render(<ReviewsPanel />);
      openFirstReview();

      expect(screen.getByTestId("review-closed")).toBeInTheDocument();
      expect(screen.queryByTestId("review-judges")).not.toBeInTheDocument();
    });
  });

  describe("dismissing", () => {
    it("closes the review without labels, and says it will not count toward kappa", async () => {
      render(<ReviewsPanel />);
      openFirstReview();
      expect(screen.getByText(/never counts toward kappa/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Dismiss without labels" }));

      await waitFor(() =>
        expect(h.dismiss).toHaveBeenCalledWith({
          id: "11111111-aaaa-bbbb-cccc-000000000001",
          notes: "",
        }),
      );
      expect(h.toastSuccess).toHaveBeenCalledWith("Review dismissed.");
    });
  });

  describe("states of one review", () => {
    it("shows a skeleton while it loads, and a failure with a retry", () => {
      h.review.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      const { unmount } = render(<ReviewsPanel />);
      openFirstReview();
      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      unmount();

      const refetch = vi.fn();
      h.review.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      render(<ReviewsPanel />);
      openFirstReview();
      within(screen.getByRole("dialog")).getByRole("button", { name: "Try again" });
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Try again" }),
      );
      expect(refetch).toHaveBeenCalled();
    });
  });
});
