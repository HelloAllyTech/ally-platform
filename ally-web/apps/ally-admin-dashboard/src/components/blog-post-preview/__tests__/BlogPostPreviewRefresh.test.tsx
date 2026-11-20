import "@constants";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { load: vi.fn() } }));
vi.mock("@api", () => ({
  useLazyGetBlogQuery: () => [state.load, { isFetching: false }],
  useGetBlogReviewQuery: () => ({ data: undefined, isLoading: true, isError: false }),
  useCreateBlogReviewLinkMutation: () => [vi.fn(), { isLoading: false }],
  useRevokeBlogReviewLinkMutation: () => [vi.fn(), { isLoading: false }],
  useSetBlogSuggestionStatusMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock("@utils", () => ({}));
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { BlogPostPreview, BlogPreviewData } from "../BlogPostPreview";

const base: BlogPreviewData = {
  title: "Unsaved title",
  body: "<p>Unsaved body</p>",
  tags: [],
  coverColor: "#D97757",
  status: "DRAFT",
};
const savedPost = {
  id: "p1",
  slug: "s",
  title: "Saved title",
  body: "<p>Saved body</p>",
  tags: [],
  coverColor: "#D97757",
  status: "DRAFT",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BlogPostPreview refresh", () => {
  it("has no Refresh or Share for a post that was never saved", () => {
    render(<BlogPostPreview post={base} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share for review" })).toBeNull();
  });

  it("re-reads the saved post and says it is the saved version for unsaved previews", async () => {
    state.load.mockResolvedValue({ data: savedPost });
    render(
      <BlogPostPreview post={base} saved={{ id: "p1", slug: "s" }} unsaved onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/Showing the saved version/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("heading", { name: "Saved title" })).toBeInTheDocument();
    expect(state.load).toHaveBeenCalledWith("p1", false);
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument();
    expect(screen.getByText(/Showing the saved version/)).toBeInTheDocument();
  });

  it("does not show the note when the preview was already the saved post", async () => {
    state.load.mockResolvedValue({ data: savedPost });
    render(<BlogPostPreview post={base} saved={{ id: "p1", slug: "s" }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/Updated just now/);
    expect(screen.queryByText(/Showing the saved version/)).toBeNull();
  });

  it("shows a short error and keeps the current content when the refresh fails", async () => {
    state.load.mockResolvedValue({ error: { status: 500 } });
    render(<BlogPostPreview post={base} saved={{ id: "p1", slug: "s" }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh"));
    expect(screen.getByRole("heading", { name: "Unsaved title" })).toBeInTheDocument();
  });

  it("opens the share dialog from the top bar, and Escape closes only the dialog", () => {
    const onClose = vi.fn();
    render(<BlogPostPreview post={base} saved={{ id: "p1", slug: "s" }} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Share for review" }));
    expect(screen.getByRole("dialog", { name: "Share for review" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Share for review" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
