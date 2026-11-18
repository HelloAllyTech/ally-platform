import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import type { FoundPages } from "@api";

const h = vi.hoisted(() => ({
  found: { current: null as unknown },
  choose: vi.fn(),
  undo: vi.fn(),
  sources: { current: [] as unknown[] },
  preview: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));

const unwrapped = (fn: (args: unknown) => unknown) => (args: unknown) => ({
  unwrap: () => Promise.resolve(fn(args)),
});

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetFoundPagesQuery: () => ({ data: h.found.current, isLoading: false, isError: false }),
  useChoosePagesMutation: () => [unwrapped(h.choose), { isLoading: false }],
  useUndoPagesMutation: () => [h.undo],
  useGetSourcesQuery: () => ({ data: h.sources.current }),
  usePreviewSourceMutation: () => [unwrapped(h.preview), { isLoading: false }],
  useRemoveSourceMutation: () => [unwrapped(h.remove), { isLoading: false }],
  useRestoreSourceMutation: () => [h.restore, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { SourcesList } from "../../AssistantHome/sections/Sources";
// eslint-disable-next-line import/first
import { HOME } from "../../AssistantHome/copy";
// eslint-disable-next-line import/first
import { ChoosePages } from "../ChoosePages";
// eslint-disable-next-line import/first
import { COPY } from "../copy";
// eslint-disable-next-line import/first
import { choiceFrom, leftOutBy } from "../pageChoice";

const SITE = "https://sunrise.example";
const pageOf = (path: string, read = true) => ({
  url: `${SITE}${path}`,
  path,
  title: path,
  read,
});
const FOUND: FoundPages = {
  choice: { include: [], exclude: [] },
  groups: [
    { section: "", pages: [pageOf("/")] },
    { section: "blog", pages: [pageOf("/blog/one"), pageOf("/blog/two", false)] },
    { section: "careers", pages: [pageOf("/careers", false)] },
    { section: "services", pages: [pageOf("/services/a"), pageOf("/services/b")] },
  ],
};

describe("page choice", () => {
  it("leaves out a whole section as one pattern, a single page by its path", () => {
    const out = new Set([`${SITE}/blog/one`, `${SITE}/blog/two`, `${SITE}/services/b`]);
    expect(choiceFrom(FOUND, out)).toEqual({
      include: [],
      exclude: ["/blog", "/services/b"],
    });
    expect(choiceFrom(FOUND, new Set())).toEqual({ include: [], exclude: [] });
  });

  it("never leaves out the home page", () => {
    expect(choiceFrom(FOUND, new Set([`${SITE}/`]))).toEqual({ include: [], exclude: [] });
  });

  it("shows a saved choice again", () => {
    const saved = { ...FOUND, choice: { include: [], exclude: ["/blog"] } };
    expect([...leftOutBy(saved)].sort()).toEqual([`${SITE}/blog/one`, `${SITE}/blog/two`]);
  });
});

describe("ChoosePages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.found.current = FOUND;
  });

  it("groups by section and saves with the blog and careers shortcuts", async () => {
    h.choose.mockReturnValue({ choice: {}, removed: 1, eventId: "e-1" });
    render(<ChoosePages draftId="d1" onClose={vi.fn()} />);
    expect(screen.getByText(COPY.pages.home)).toBeTruthy();
    expect(screen.getByText("All of services")).toBeTruthy();
    fireEvent.click(screen.getByText(COPY.pages.leaveOutBlog));
    fireEvent.click(screen.getByText(COPY.pages.leaveOutCareers));
    fireEvent.click(screen.getByText(COPY.pages.save));
    await waitFor(() =>
      expect(h.choose).toHaveBeenCalledWith({
        id: "d1",
        include: [],
        exclude: ["/blog", "/careers"],
      }),
    );
    expect(await screen.findByText("Saved. It forgot 1 pages you left out.")).toBeTruthy();
    fireEvent.click(screen.getByText(COPY.pages.undo));
    expect(h.undo).toHaveBeenCalledWith({ id: "d1", eventId: "e-1" });
  });
});

describe("SourcesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sources.current = [
      { url: `${SITE}/fees`, title: "Fees", details: 2, removed: false, eventId: null },
      { url: `${SITE}/old`, title: "Old", details: 1, removed: true, eventId: "e-9" },
    ];
  });

  it("says how many details go before removing, then removes", async () => {
    h.preview.mockReturnValue({ url: `${SITE}/fees`, title: "Fees", details: 2 });
    h.remove.mockReturnValue({ eventId: "e-2" });
    render(<SourcesList botId="b1" canEdit />);
    fireEvent.click(screen.getAllByText(HOME.sources.remove)[0]);
    expect(
      await screen.findByText(
        "Remove Fees? Your assistant will forget 2 details that came only from this page.",
      ),
    ).toBeTruthy();
    expect(h.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByText(HOME.sources.remove).at(-1)!);
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith({ id: "b1", url: `${SITE}/fees` }));
  });

  it("puts a removed page back", () => {
    render(<SourcesList botId="b1" canEdit />);
    fireEvent.click(screen.getByText(HOME.sources.putBack));
    expect(h.restore).toHaveBeenCalledWith({ id: "b1", eventId: "e-9" });
  });

  it("is read-only for a viewer", () => {
    render(<SourcesList botId="b1" canEdit={false} />);
    expect(screen.queryByText(HOME.sources.remove)).toBeNull();
    expect(screen.queryByText(HOME.sources.putBack)).toBeNull();
  });
});
