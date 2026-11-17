import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoadmapCutoverPreview } from "@types";

let mockQuery: Record<string, unknown>;
const mockRefetch = vi.fn();
const mockRun = vi.fn();
let mockRunning = false;
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapCutoverPreviewQuery: () => ({ refetch: mockRefetch, ...mockQuery }),
  useRunRoadmapCutoverMutation: () => [mockRun, { isLoading: mockRunning }],
}));

import { RoadmapSwitchOnSection } from "../cutover/RoadmapSwitchOnSection";

const preview = (overrides: Partial<RoadmapCutoverPreview> = {}): RoadmapCutoverPreview => ({
  roadmapV2Enabled: false,
  builders: [
    { userId: 3, name: "Ravi" },
    { userId: 5, name: "Dev" },
  ],
  owners: [{ userId: 1, name: "Asha" }],
  withoutRoadmapAccess: [],
  drafts: {
    total: 2,
    items: [
      { id: "d1", authorUserId: 7, authorName: "Meera", title: "Pin a note" },
      { id: "d2", authorUserId: 8, authorName: "Kiran", title: "Dark mode" },
    ],
  },
  sessions: {
    total: 1,
    items: [
      {
        sessionId: "s1",
        title: "Faster session start",
        status: "BUILDING",
        creatorUserId: 3,
        creatorName: "Ravi",
      },
    ],
  },
  reviewBackfill: { total: 4 },
  goal: "Engagement",
  lastRun: null,
  ...overrides,
});

const result = {
  counts: { draftsMoved: 2, sessionsFiled: 1, reviewsAccepted: 4, builders: 2, owners: 1 },
  drafts: [],
  filed: [],
  roadmapV2Enabled: true as const,
  at: "2026-11-17T10:00:00Z",
};

const renderSection = () =>
  render(
    <MemoryRouter>
      <RoadmapSwitchOnSection />
    </MemoryRouter>,
  );

const confirmDialog = () => screen.getByRole("dialog");

describe("RoadmapSwitchOnSection", () => {
  beforeEach(() => {
    mockQuery = { data: preview(), isLoading: false, isFetching: false, error: undefined };
    mockRun.mockReset();
    mockRefetch.mockReset();
    mockRunning = false;
  });

  it("renders nothing for someone who isn't an Owner (403)", () => {
    mockQuery = { data: undefined, isLoading: false, error: { status: 403 } };
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a skeleton while it checks", () => {
    mockQuery = { data: undefined, isLoading: true };
    renderSection();
    expect(screen.getByRole("region", { name: "Switch on Roadmap" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Switch on Roadmap" })).not.toBeInTheDocument();
  });

  it("offers a retry when the check fails to load", () => {
    mockQuery = { data: undefined, isLoading: false, error: { status: 500 } };
    renderSection();
    expect(screen.getByText("Couldn't load the switch-on check.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("lists who gets which role, by name, and what moves", () => {
    mockQuery.data = preview({ withoutRoadmapAccess: [{ userId: 5, name: "Dev" }] });
    renderSection();
    expect(screen.getByText("Owners (1)")).toBeInTheDocument();
    expect(screen.getByText("Builders (2)")).toBeInTheDocument();
    expect(screen.getByText("Asha")).toBeInTheDocument();
    expect(
      screen.getByText(/Dev will get the role but can't open the Roadmap/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 parked ideas become private drafts in their authors' My drafts"),
    ).toBeInTheDocument();
    expect(screen.getByText("Pin a note (Meera)")).toBeInTheDocument();
    expect(
      screen.getByText(/1 live Builder session gets an idea of its own.*under Engagement/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("4 ideas filed before review existed are marked Accepted"),
    ).toBeInTheDocument();
  });

  it("says when there is nothing to move, and still lets the Owner switch on", () => {
    mockQuery.data = preview({
      drafts: { total: 0, items: [] },
      sessions: { total: 0, items: [] },
      reviewBackfill: { total: 0 },
    });
    renderSection();
    expect(screen.getByText(/Nothing to move/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch on Roadmap" })).toBeEnabled();
  });

  it("confirms first, naming what happens and that switching off brings the old tabs back", async () => {
    mockRun.mockReturnValue({ unwrap: () => Promise.resolve(result) });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Switch on Roadmap" }));
    const dialog = confirmDialog();
    expect(within(dialog).getByText(/become one tab, Roadmap, for everyone/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeInTheDocument();
    expect(mockRun).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Switch on Roadmap" }));
    await waitFor(() =>
      expect(mockRun).toHaveBeenCalledWith({ confirmedBuilderIds: [3, 5], confirmedOwnerIds: [1] }),
    );
    expect(await screen.findByText("Roadmap is on")).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 drafts moved, 1 Builder session filed as ideas, 4 ideas marked Accepted.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Roadmap" })).toHaveAttribute("href", "/roadmap");
  });

  it("asks the Owner to look again on 409, and refetches the list", async () => {
    mockRun.mockReturnValue({
      unwrap: () => Promise.reject({ status: 409, data: { code: "roles_changed" } }),
    });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Switch on Roadmap" }));
    fireEvent.click(within(confirmDialog()).getByRole("button", { name: "Switch on Roadmap" }));
    expect(
      await screen.findByText("Access changed since you looked. Review the list again."),
    ).toBeInTheDocument();
    expect(mockRefetch).toHaveBeenCalled();
    expect(screen.queryByText("Roadmap is on")).not.toBeInTheDocument();
  });

  it("says nothing changed when the run fails", async () => {
    mockRun.mockReturnValue({ unwrap: () => Promise.reject({ status: 500 }) });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Switch on Roadmap" }));
    fireEvent.click(within(confirmDialog()).getByRole("button", { name: "Switch on Roadmap" }));
    expect(
      await screen.findByText("Couldn't switch Roadmap on. Nothing changed. Try again."),
    ).toBeInTheDocument();
  });

  it("blocks the run when sessions need a goal and none exists", () => {
    mockQuery.data = preview({ goal: null });
    renderSection();
    expect(
      screen.getByText(/Add a product goal in Product Roadmap settings first/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch on Roadmap" })).toBeDisabled();
  });

  describe("once Roadmap is on", () => {
    it("shows the last run and offers to move only what's left", () => {
      mockQuery.data = preview({
        roadmapV2Enabled: true,
        drafts: { total: 1, items: [preview().drafts.items[0]] },
        sessions: { total: 0, items: [] },
        reviewBackfill: { total: 0 },
        lastRun: {
          at: "2026-11-17T10:00:00Z",
          actorUserId: 1,
          actorName: "Asha",
          counts: result.counts,
        },
      });
      renderSection();
      expect(screen.getByTestId("roadmap-switch-on-last-run")).toHaveTextContent(
        /by Asha\. 2 drafts moved, 1 Builder session filed as ideas, 4 ideas marked Accepted\./,
      );
      expect(screen.getByRole("button", { name: "Move what's left" })).toBeEnabled();
    });

    it("has no button when there is nothing left to move", () => {
      mockQuery.data = preview({
        roadmapV2Enabled: true,
        drafts: { total: 0, items: [] },
        sessions: { total: 0, items: [] },
        reviewBackfill: { total: 0 },
      });
      renderSection();
      expect(
        screen.queryByRole("button", { name: /Switch on Roadmap|Move what's left/ }),
      ).toBeNull();
    });
  });
});
