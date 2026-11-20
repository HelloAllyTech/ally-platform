import "@constants";

import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

const saved = {
  id: "p1",
  title: "Saved post",
  slug: "saved",
  tldr: "Saved tldr",
  body: "<p>Saved body</p>",
  tags: ["Tag"],
  coverColor: "#8B9A6D",
  status: "PUBLISHED",
  publishedAt: "2026-10-01T00:00:00Z",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

vi.mock("@api", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mutation = () => [vi.fn(), { isLoading: false }];
  return {
    ...actual,
    useGetBlogsQuery: () => ({ data: { blogs: [saved], count: 1 }, isFetching: false }),
    useCreateBlogMutation: mutation,
    useUpdateBlogMutation: mutation,
    usePublishBlogMutation: mutation,
    useUnpublishBlogMutation: mutation,
    useDeleteBlogMutation: mutation,
  };
});

vi.mock("@components/blog-claude-connect", () => ({
  BlogClaudeConnect: () => null,
  useBlogClaudeConnect: () => ({
    canConnect: false,
    open: false,
    openSheet: vi.fn(),
    closeSheet: vi.fn(),
  }),
}));

import { store } from "@src/store";

import { BlogManagement } from "../Blog";

describe("Blog row preview", () => {
  it("previews the saved post from its row", () => {
    render(
      <Provider store={store}>
        <BlogManagement />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("dialog", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByText("Saved body")).toBeInTheDocument();
    expect(screen.getByTestId("blog-preview-status")).toHaveTextContent("Published");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Preview" })).toBeNull();
  });

  it("opens the share dialog from the row's Share action", () => {
    render(
      <Provider store={store}>
        <BlogManagement />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByRole("dialog", { name: "Share for review" })).toBeInTheDocument();
    expect(screen.getByText(/This post is published and public/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Share for review" })).toBeNull();
  });
});
