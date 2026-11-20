import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlogPost } from "@api";

const { mockQuery, mockCreate } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("@api", () => ({
  useGetBlogReviewQuery: () => mockQuery(),
  useCreateBlogReviewSuggestionMutation: () => [mockCreate, { isLoading: false }],
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  RichTextRenderer: ({ content }: { content?: string | null }) => (
    <div data-testid="rich" dangerouslySetInnerHTML={{ __html: content ?? "" }} />
  ),
}));

vi.mock("../BlogHeader", () => ({ BlogHeader: () => <header /> }));
vi.mock("../ShareActions", () => ({ ShareActions: () => <span /> }));

import { AuthorBlock } from "../BlogArticle";
import { BlogReview } from "../BlogReview";

const post = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  id: "1",
  title: "Hello draft",
  slug: "hello",
  tldr: "Short",
  body: "<p>Body text here</p>",
  tags: [],
  coverColor: "", // empty = default cover; not under test here
  authorName: "Asha",
  authorEmail: "asha@example.com",
  status: "DRAFT",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...overrides,
});

const loaded = (status: "DRAFT" | "PUBLISHED" = "DRAFT", p = post()) =>
  mockQuery.mockReturnValue({
    data: { status, slug: "hello", expiresAt: "2026-12-01T00:00:00Z", post: p },
    isLoading: false,
    isError: false,
  });

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/blog/review/tok"]}>
      <Routes>
        <Route path="/blog/review/:token" element={<BlogReview />} />
        <Route path="/blog/:slug" element={<div>Public post page</div>} />
        <Route path="/blog" element={<div>Blog home</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockCreate.mockReturnValue({ unwrap: () => Promise.resolve({ success: true }) });
});

describe("BlogReview", () => {
  it("renders the draft with banner, noindex and title", () => {
    loaded();
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Hello draft" })).toBeTruthy();
    expect(screen.getByText(/This is a draft for review/)).toBeTruthy();
    expect(screen.getByText(/This link works until/)).toBeTruthy();
    expect(document.title).toBe("Draft: Hello draft");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex, nofollow",
    );
    expect(screen.getByTestId("author-block").textContent).toContain("asha@example.com");
  });

  it("redirects to the public post when published", () => {
    loaded("PUBLISHED");
    renderPage();
    expect(screen.getByText("Public post page")).toBeTruthy();
  });

  it("shows a calm message when the link is invalid", () => {
    mockQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(
      screen.getByText("This review link is not valid any more. Ask the author for a new one."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /blog home/i }).getAttribute("href")).toBe("/blog");
  });

  it("offers a chip for selected article text and uses it as the quote", async () => {
    loaded();
    renderPage();
    const node = screen.getByTestId("rich");
    const selection = {
      toString: () => "  Body text  ",
      rangeCount: 1,
      getRangeAt: () => ({
        commonAncestorContainer: node,
        getBoundingClientRect: () => ({ top: 100, left: 50 }),
      }),
    };
    vi.spyOn(window, "getSelection").mockReturnValue(selection as unknown as Selection);
    fireEvent.mouseUp(node);
    const chip = await screen.findByRole("button", { name: "Suggest a change to this text" });
    fireEvent.click(chip);
    expect((screen.getByLabelText(/About this text/) as HTMLTextAreaElement).value).toBe(
      "Body text",
    );
  });

  it("validates, submits, thanks and clears the comment but keeps the name", async () => {
    loaded();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Send suggestion" }));
    expect(screen.getByText("Please enter your name.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Your name"), "Ravi");
    await user.type(screen.getByLabelText("Your comment"), "Fix the typo");
    await user.click(screen.getByRole("button", { name: "Send suggestion" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        token: "tok",
        body: { name: "Ravi", comment: "Fix the typo" },
      }),
    );
    expect(
      await screen.findByText("Thank you. Your suggestion was sent to the author."),
    ).toBeTruthy();
    expect((screen.getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Ravi");
  });

  it("shows a polite message on 429", async () => {
    loaded();
    mockCreate.mockReturnValue({ unwrap: () => Promise.reject({ status: 429 }) });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Your name"), "Ravi");
    await user.type(screen.getByLabelText("Your comment"), "Hi");
    await user.click(screen.getByRole("button", { name: "Send suggestion" }));
    expect(await screen.findByText(/a little fast/)).toBeTruthy();
  });
});

describe("AuthorBlock", () => {
  it("shows name, email and website", () => {
    render(<AuthorBlock post={{ authorName: "Asha", authorEmail: "asha@example.com" }} />);
    expect(screen.getByText("Written by")).toBeTruthy();
    expect(screen.getByText("Asha")).toBeTruthy();
    expect(screen.getByRole("link", { name: "asha@example.com" }).getAttribute("href")).toBe(
      "mailto:asha@example.com",
    );
    expect(screen.getByRole("link", { name: "helloally.ai" })).toBeTruthy();
  });

  it("shows only the Ally line without an author", () => {
    render(<AuthorBlock post={{ authorName: null, authorEmail: null }} />);
    expect(screen.queryByText("Written by")).toBeNull();
    expect(screen.getByRole("link", { name: "helloally.ai" })).toBeTruthy();
  });
});
