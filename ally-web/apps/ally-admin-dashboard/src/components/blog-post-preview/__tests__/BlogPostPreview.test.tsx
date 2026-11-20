import "@constants";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BlogPostPreview, BlogPreviewData } from "../BlogPostPreview";

const base: BlogPreviewData = {
  title: "Hello world",
  tldr: "Short summary",
  body: "<p>Body text</p><blockquote>Quoted</blockquote>",
  tags: ["Engineering", "Care"],
  coverColor: "#D97757",
  authorName: "Jane Doe",
  headerImageUrl: "",
  status: "DRAFT",
  date: "2026-10-01T00:00:00Z",
};

const setup = (over: Partial<BlogPreviewData> = {}) => {
  const onClose = vi.fn();
  render(<BlogPostPreview post={{ ...base, ...over }} onClose={onClose} />);
  return onClose;
};

describe("BlogPostPreview", () => {
  it("renders title, tldr, byline, tags and body", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Hello world" })).toBeInTheDocument();
    expect(screen.getByText("Short summary")).toBeInTheDocument();
    expect(screen.getByText("By Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("#Engineering")).toBeInTheDocument();
    expect(screen.getByText("#Care")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByText("Quoted")).toBeInTheDocument();
  });

  it("shows the draft notice and status for drafts", () => {
    setup();
    expect(screen.getByText("Not published yet. Readers cannot see this.")).toBeInTheDocument();
    expect(screen.getByTestId("blog-preview-status")).toHaveTextContent("Draft");
  });

  it("shows Published and no notice for published posts", () => {
    setup({ status: "PUBLISHED" });
    expect(screen.queryByText(/Not published yet/)).toBeNull();
    expect(screen.getByTestId("blog-preview-status")).toHaveTextContent("Published");
  });

  it("fills the cover with the colour when there is no header image", () => {
    setup();
    expect(screen.getByTestId("blog-preview-cover")).toHaveStyle({
      backgroundColor: "rgb(217, 119, 87)",
    });
  });

  it("shows the header image instead of the cover colour", () => {
    setup({ headerImageUrl: "https://x.test/a.png" });
    expect(screen.queryByTestId("blog-preview-cover")).toBeNull();
    expect(screen.getByAltText("Hello world")).toHaveAttribute("src", "https://x.test/a.png");
  });

  it("toggles the article width between desktop and mobile", () => {
    setup();
    const frame = screen.getByTestId("blog-preview-frame");
    expect(frame).toHaveStyle({ maxWidth: "1000px" });
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(frame).toHaveStyle({ maxWidth: "390px" });
    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(frame).toHaveStyle({ maxWidth: "1000px" });
  });

  it("closes with the Close button and with Escape", () => {
    const onClose = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
