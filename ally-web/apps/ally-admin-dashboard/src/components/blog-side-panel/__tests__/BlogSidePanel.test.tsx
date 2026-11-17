import "@constants";

import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { BlogPost } from "@api";
import { store } from "@src/store";

import { BLOG_COVER_COLORS, BlogSidePanel } from "../BlogSidePanel";

const post: BlogPost = {
  id: "post-1",
  title: "Hello",
  slug: "hello",
  tags: ["Engineering"],
  coverColor: "#D97757",
  status: "DRAFT",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

const renderPanel = (
  selectedBlog: BlogPost | null,
  onSave = vi.fn().mockResolvedValue(undefined),
) => {
  render(
    <Provider store={store}>
      <MemoryRouter>
        <BlogSidePanel selectedBlog={selectedBlog} isOpen onClose={vi.fn()} onSave={onSave} />
      </MemoryRouter>
    </Provider>,
  );
  return onSave;
};

describe("BlogSidePanel cover colour", () => {
  it("has no category field — tags are the only taxonomy", () => {
    renderPanel(post);
    expect(screen.queryByText("Category")).toBeNull();
  });

  it("defaults a new post to the first palette colour", () => {
    renderPanel(null);
    expect(screen.getByRole("radio", { name: BLOG_COVER_COLORS[0].name })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows the post's saved colour as selected", () => {
    renderPanel(post);
    expect(screen.getByRole("radio", { name: "Clay" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Sage" })).toHaveAttribute("aria-checked", "false");
  });

  it("saves the picked colour", () => {
    const onSave = renderPanel(post);
    fireEvent.click(screen.getByRole("radio", { name: "Umber" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ coverColor: "#565045", tags: ["Engineering"] }),
      false,
      false,
    );
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("category");
  });
});

describe("BlogSidePanel save buttons", () => {
  const published: BlogPost = { ...post, status: "PUBLISHED" };

  it("does not call the unpublish action 'Save as draft' on a published post", () => {
    renderPanel(published);
    expect(screen.queryByRole("button", { name: "Save as draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unpublish and save as draft" })).toBeInTheDocument();
  });

  it("'Save and keep editing' keeps a published post published and leaves the panel open", () => {
    const onSave = renderPanel(published);
    fireEvent.click(screen.getByRole("button", { name: "Save and keep editing" }));
    expect(onSave).toHaveBeenCalledWith(expect.anything(), true, true);
  });

  it("'Save and keep editing' on a draft stays a draft", () => {
    const onSave = renderPanel(post);
    fireEvent.click(screen.getByRole("button", { name: "Save and keep editing" }));
    expect(onSave).toHaveBeenCalledWith(expect.anything(), false, true);
  });
});
