import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderDecision } from "@types";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => toastSuccess(...args),
    error: (...args: any[]) => toastError(...args),
  },
}));

vi.mock("@ally-ui-mono/ui-shared", async () => {
  const React = await import("react");
  return {
    Button: ({ children, onClick, disabled }: any) => (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    SkeletonText: () => <div>Loading…</div>,
    Tag: ({ children }: any) => <span>{children}</span>,
    Tile: ({ children }: any) => <div>{children}</div>,
    TextArea: React.forwardRef(({ labelText, hideLabel, ...rest }: any, ref: any) => (
      <textarea ref={ref} aria-label={labelText} {...rest} />
    )),
  };
});

// `src/utils/index.ts` and `src/hooks` pull in the real store; stubbed as the sibling page tests do.
vi.mock("@hooks", () => ({}));
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@utils", () => ({
  formatRelativeTime: () => "3m ago",
  getErrorMessage: (error: any, fallback: string) => error?.data?.message ?? fallback,
}));

const answerMock = vi.fn();
let feed: {
  data: { decisions: BuilderDecision[]; count: number } | undefined;
  isLoading: boolean;
  isError: boolean;
};
const refetch = vi.fn();

vi.mock("@api", () => ({
  useGetBuilderDecisionsQuery: () => ({ ...feed, refetch }),
  useAnswerBuilderDecisionMutation: () => [answerMock],
}));

// eslint-disable-next-line import/first
import { BuilderDecisions } from "../BuilderDecisions";

const decision = (overrides: Partial<BuilderDecision>): BuilderDecision => ({
  id: "question:s1:q1",
  kind: "question",
  category: "what",
  sessionId: "s1",
  sessionTitle: "Weekly digest",
  sessionStatus: "INTERVIEWING",
  createdByName: null,
  repos: [],
  prompt: "Monday or Friday?",
  rationale: null,
  questionType: null,
  context: [],
  blocked: "Scoping is paused.",
  selection: "single",
  options: [{ id: "mon", label: "Monday", recommended: true }],
  allowCustom: false,
  allowNone: false,
  minSelections: null,
  customPlaceholder: null,
  waitingSince: "2026-10-28T09:00:00Z",
  pullRequestUrl: null,
  ...overrides,
});

const twoDecisions = () => [
  decision({ id: "question:s1:q1", prompt: "Monday or Friday?" }),
  decision({
    id: "pr_merge:s2:pr1",
    kind: "pr_merge",
    category: "issue",
    sessionId: "s2",
    sessionTitle: "Debrief ratings",
    prompt: "Merge ally-be #12?",
    options: [{ id: "merge", label: "Merge", recommended: true }],
  }),
];

describe("BuilderDecisions", () => {
  beforeEach(() => {
    answerMock.mockReset();
    navigateMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    feed = { data: { decisions: [], count: 0 }, isLoading: false, isError: false };
  });

  it("shows the empty state when nothing is waiting", () => {
    render(<BuilderDecisions />);

    expect(screen.getByText("Nothing needs you")).toBeInTheDocument();
  });

  it("focuses the highest-priority card first and lists the rest in the rail", () => {
    feed.data = { decisions: twoDecisions(), count: 2 };
    render(<BuilderDecisions />);

    // The merge outranks the question (see DECISION_KIND_PRIORITY).
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Decisions");
    const rail = screen.getByRole("list", { name: "Up next" });
    expect(rail).toHaveTextContent("Merge ally-be #12?");
    expect(rail).toHaveTextContent("Monday or Friday?");
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
  });

  it("answers the card, moves on, and reports the outcome", async () => {
    feed.data = { decisions: twoDecisions(), count: 2 };
    answerMock.mockReturnValue({ unwrap: () => Promise.resolve({ ok: true, outcome: "merged" }) });
    render(<BuilderDecisions />);

    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Merged."));
    expect(answerMock).toHaveBeenCalledWith({
      id: "pr_merge:s2:pr1",
      selectedOptionIds: ["merge"],
    });
    // The answered card is gone from the queue; the question is now the one in focus.
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("1 decided")).toBeInTheDocument();
  });

  it("keeps the card and shows the server's reason when an answer is refused", async () => {
    feed.data = { decisions: twoDecisions(), count: 2 };
    answerMock.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Checks are not green." } }),
    });
    render(<BuilderDecisions />);

    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Checks are not green."));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(refetch).toHaveBeenCalled();
  });

  it("skips to the next card on S and sends the skipped one to the back", () => {
    feed.data = { decisions: twoDecisions(), count: 2 };
    render(<BuilderDecisions />);

    fireEvent.keyDown(window, { key: "s" });

    expect(screen.getByText("Monday or Friday?", { selector: "p" })).toBeInTheDocument();
    const rail = screen.getByRole("list", { name: "Up next" });
    expect(rail).toHaveTextContent("Skipped");
  });

  it("filters by category and says when a group is empty", () => {
    feed.data = { decisions: twoDecisions(), count: 2 };
    render(<BuilderDecisions />);

    fireEvent.click(screen.getByText("How to build"));

    expect(screen.getByText("Nothing in this group. Try another filter.")).toBeInTheDocument();
  });

  it("opens the focused card's session on O", () => {
    feed.data = { decisions: twoDecisions(), count: 2 };
    render(<BuilderDecisions />);

    fireEvent.keyDown(window, { key: "o" });

    expect(navigateMock).toHaveBeenCalledWith("/builder/s2");
  });

  it("reports a failed load once", () => {
    feed = { data: undefined, isLoading: false, isError: true };
    render(<BuilderDecisions />);

    expect(toastError).toHaveBeenCalledWith("Couldn't load the decision feed.");
  });
});
