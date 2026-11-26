import "@constants";
import React from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { ManualPageDetail, ManualPageRow, ManualState } from "@types";

const rows: ManualPageRow[] = [
  {
    slug: "practice",
    title: "Practice",
    summary: "Getting better with roleplays",
    parentSlug: null,
    position: 0,
    kind: "section",
    roles: [],
    surfaces: [],
    journeys: [],
    releaseState: "live",
    verifiedAt: null,
    updatedAt: "2026-11-20T10:00:00Z",
  },
  {
    slug: "start-a-roleplay",
    title: "Start a roleplay",
    summary: "From the course to the first line",
    parentSlug: "practice",
    position: 0,
    kind: "page",
    roles: ["learner"],
    surfaces: ["mobile"],
    journeys: [],
    releaseState: "next",
    verifiedAt: "2026-11-24T10:00:00Z",
    updatedAt: "2026-11-25T10:00:00Z",
  },
  {
    slug: "scores",
    title: "Scores",
    summary: "Where a score comes from",
    parentSlug: "practice",
    position: 1,
    kind: "page",
    roles: ["learner"],
    surfaces: ["web"],
    journeys: [],
    releaseState: "live",
    verifiedAt: null,
    updatedAt: "2026-11-20T10:00:00Z",
  },
];

const detail: ManualPageDetail = {
  ...rows[1],
  body: "## Before you start\n\nPick a course. See [[scores|how scoring works]] and [[missing-page]].\n\n## Talking\n\nSpeak.",
  verifiedRef: null,
  backlinks: [{ slug: "scores", title: "Scores" }],
  outlinks: [{ slug: "scores", title: "Scores" }],
  breadcrumb: [{ slug: "practice", title: "Practice" }],
  children: [],
  lastChange: null,
};

const manualState: ManualState = {
  agentState: "idle",
  banner: null,
  budget: { monthlyBudgetUsd: 100, spentUsd: 0, reservedUsd: 0 },
  lastRun: null,
  nextRunAt: null,
  openProposals: 0,
  openGaps: 0,
  analyticsAvailable: false,
  canAdminister: false,
};

const mockPage = vi.fn();
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetManualTreeQuery: () => ({
    data: rows,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useGetManualStateQuery: () => ({ data: manualState }),
  useGetManualPageQuery: (slug: string, options?: { skip?: boolean }) => mockPage(slug, options),
  useGetManualConversationsQuery: () => ({ data: [] }),
  useLazyGetManualConversationQuery: () => [vi.fn()],
  useDeleteManualConversationMutation: () => [vi.fn(), { isLoading: false }],
  useLazyGetManualChangesQuery: () => [vi.fn()],
  useRevertManualPageMutation: () => [vi.fn(), { isLoading: false }],
  useGetManualChangesQuery: () => ({ data: [], isLoading: false, isError: false }),
  useSearchManualQuery: () => ({ data: undefined, isFetching: false, isError: false }),
  useSaveManualDraftMutation: () => [vi.fn(), { isLoading: false }],
  useDismissManualDraftMutation: () => [vi.fn(), { isLoading: false }],
}));

import { ManualShell } from "../ManualShell";

const renderShell = (slug: string | null = "start-a-roleplay") =>
  render(
    <MemoryRouter initialEntries={[slug ? `/roadmap/manual/${slug}` : "/roadmap/manual"]}>
      <Routes>
        <Route path="/roadmap/manual" element={<ManualShell slug={null} />} />
        <Route path="/roadmap/manual/:slug" element={<ManualShell slug={slug} />} />
      </Routes>
    </MemoryRouter>,
  );

const chatPanel = () => screen.queryByTestId("manual-chat-panel");

describe("ManualShell", () => {
  const width = window.innerWidth;
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    mockPage.mockReset();
    mockPage.mockImplementation((slug: string, options?: { skip?: boolean }) =>
      options?.skip
        ? { data: undefined }
        : slug === "start-a-roleplay"
          ? { data: detail, isLoading: false, isFetching: false, isError: false }
          : {
              data: undefined,
              isLoading: false,
              isFetching: false,
              isError: true,
              error: { status: 404 },
              refetch: vi.fn(),
            },
    );
  });
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  });

  it("reads a page: breadcrumb, title, meta, wikilinks only to pages that exist, tree", () => {
    renderShell();
    expect(screen.getByRole("heading", { level: 1, name: "Start a roleplay" })).toBeInTheDocument();
    const article = screen.getByRole("article");
    expect(within(article).getByText(en.productManual.shipsNext)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "how scoring works" });
    expect(link).toHaveAttribute("href", "/roadmap/manual/scores");
    expect(screen.queryByRole("link", { name: "missing-page" })).toBeNull();
    expect(screen.getByText(/missing-page/)).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: en.productManual.onThisPage }),
    ).toBeInTheDocument();
    const tree = screen.getByRole("tree");
    expect(within(tree).getByRole("treeitem", { name: /Start a roleplay/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens Ask with the button and leaves with Escape", async () => {
    renderShell();
    expect(chatPanel()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: en.productManual.askAria }));
    expect(chatPanel()).not.toBeNull();
    expect(screen.getByText(en.productManual.chat.starters[0])).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await waitFor(() => expect(chatPanel()).toBeNull());
  });

  it("toggles Ask with Ctrl+/ and opens search with Ctrl+K", async () => {
    renderShell();
    act(() => {
      fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    });
    expect(chatPanel()).not.toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: "/", metaKey: true });
    });
    await waitFor(() => expect(chatPanel()).toBeNull());
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(
      screen.getByRole("dialog", { name: en.productManual.palette.label }),
    ).toBeInTheDocument();
  });

  it("says so calmly when a page isn't in the manual", () => {
    renderShell("nowhere");
    expect(screen.getByText(en.productManual.unknownPage)).toBeInTheDocument();
  });

  it("shows the sections on the manual's front page", () => {
    renderShell(null);
    expect(
      screen.getByRole("heading", { level: 1, name: en.productManual.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Practice/ })).toHaveAttribute(
      "href",
      "/roadmap/manual/practice",
    );
  });

  it("keyboard-walks the tree", () => {
    renderShell();
    const current = screen.getByRole("treeitem", { name: /Start a roleplay/ });
    current.focus();
    fireEvent.keyDown(current, { key: "ArrowDown" });
    expect(screen.getByRole("treeitem", { name: /Scores/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(screen.getByRole("treeitem", { name: /^Practice/ })).toHaveFocus();
  });
});
