import "@constants";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastFn, state } = vi.hoisted(() => ({
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  state: {
    data: undefined as unknown,
    create: vi.fn(),
    revoke: vi.fn(),
    setStatus: vi.fn(),
    refetch: vi.fn(),
  },
}));
vi.mock("@utils", () => ({}));
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@api", () => ({
  useGetBlogReviewQuery: () => ({
    data: state.data,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: state.refetch,
  }),
  useCreateBlogReviewLinkMutation: () => [state.create, { isLoading: false }],
  useRevokeBlogReviewLinkMutation: () => [state.revoke, { isLoading: false }],
  useSetBlogSuggestionStatusMutation: () => [state.setStatus, { isLoading: false }],
}));

import { BlogShareReview } from "../index";

const unwrapped = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });
const draft = { id: "p1", slug: "my-post", status: "DRAFT" as const };
const link = { token: "tok123", expiresAt: "2026-12-01T10:00:00Z", createdAt: "2026-11-17T10:00:00Z" };
const suggestion = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "Asha",
  email: "asha@example.com",
  comment: "Fix the second paragraph",
  quote: "the second paragraph",
  status: "OPEN",
  createdAt: "2026-11-18T10:00:00Z",
  ...over,
});

beforeEach(() => {
  state.data = { link: null, suggestions: [] };
  state.create = vi.fn(() => unwrapped(link));
  state.revoke = vi.fn(() => unwrapped({ success: true }));
  state.setStatus = vi.fn(() => unwrapped({}));
  state.refetch = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("BlogShareReview", () => {
  it("explains the link in one sentence and creates one for 14 days by default", () => {
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    expect(
      screen.getByText(/Anyone with this link can read this draft and leave suggestions/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("blog-share-create"));
    expect(state.create).toHaveBeenCalledWith({ id: "p1", days: 14 });
  });

  it("creates with the chosen number of days", () => {
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "60" } });
    fireEvent.click(screen.getByTestId("blog-share-create"));
    expect(state.create).toHaveBeenCalledWith({ id: "p1", days: 60 });
  });

  it("shows the review URL and copies it", async () => {
    state.data = { link, suggestions: [] };
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    const url = `${window.location.origin}/blog/review/tok123`;
    expect(screen.getByTestId("blog-share-url")).toHaveValue(url);
    expect(screen.getByTestId("blog-share-expiry")).toHaveTextContent("Works until");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
  });

  it("selects the field and says so when the clipboard is unavailable", async () => {
    state.data = { link, suggestions: [] };
    vi.stubGlobal("navigator", {});
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
  });

  it("asks inside the dialog before turning the link off", async () => {
    state.data = { link, suggestions: [] };
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off link" }));
    expect(state.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, turn off" }));
    await waitFor(() => expect(state.revoke).toHaveBeenCalledWith("p1"));
  });

  it("extends by turning the link off and creating a new one", async () => {
    state.data = { link, suggestions: [] };
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    await waitFor(() => expect(state.create).toHaveBeenCalledWith({ id: "p1", days: 14 }));
    expect(state.revoke).toHaveBeenCalledWith("p1");
  });

  it("lists suggestions newest first, counts open ones, and marks one done or reopens it", async () => {
    state.data = {
      link,
      suggestions: [
        suggestion({ id: "old", name: "Older", quote: null, createdAt: "2026-11-17T10:00:00Z" }),
        suggestion({ id: "new", name: "Newer", status: "RESOLVED" }),
      ],
    };
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    expect(screen.getByText("Suggestions (1 open)")).toBeInTheDocument();
    const rows = screen.getAllByTestId("blog-suggestion");
    expect(rows[0]).toHaveTextContent("Newer");
    expect(rows[0]).toHaveTextContent("asha@example.com");
    expect(rows[0]).toHaveTextContent("the second paragraph");
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    await waitFor(() =>
      expect(state.setStatus).toHaveBeenCalledWith({ id: "p1", suggestionId: "old", status: "RESOLVED" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() =>
      expect(state.setStatus).toHaveBeenCalledWith({ id: "p1", suggestionId: "new", status: "OPEN" }),
    );
  });

  it("refetches the suggestions", () => {
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it("has an empty state", () => {
    render(<BlogShareReview post={draft} onClose={vi.fn()} />);
    expect(
      screen.getByText("No suggestions yet. They appear here when someone sends one."),
    ).toBeInTheDocument();
  });

  it("offers the public link, not a review link, for a published post", () => {
    render(<BlogShareReview post={{ ...draft, status: "PUBLISHED" }} onClose={vi.fn()} />);
    expect(
      screen.getByText("This post is published and public. Share its public link instead."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("blog-share-public-url")).toHaveValue(
      `${window.location.origin}/blog/my-post`,
    );
    expect(screen.queryByTestId("blog-share-create")).toBeNull();
  });
});
