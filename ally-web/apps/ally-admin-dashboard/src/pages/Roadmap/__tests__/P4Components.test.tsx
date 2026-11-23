import "@constants";
import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoadmapBuildBrief, RoadmapItemDetail } from "@types";

const mockConfetti = vi.hoisted(() => vi.fn());
vi.mock("canvas-confetti", () => ({ default: mockConfetti }));

const mockFetchBrief = vi.fn();
const mockRecordSent = vi.fn();
let mockSettings: { enabled: boolean } | undefined = { enabled: true };
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLazyGetRoadmapBriefQuery: () => [mockFetchBrief],
  useRecordRoadmapExternalBuildMutation: () => [mockRecordSent],
  useGetBuilderSettingsQuery: () => ({ data: mockSettings }),
  useGetBuilderSessionQuery: () => ({
    data: { repos: ["ally-be"], readiness: { ready: true }, prd: {}, designReadiness: null },
  }),
}));
vi.mock("@components/builder", () => ({
  StartBuildDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="start-build-dialog" /> : null,
  designBuildBlock: () => null,
}));
const toastFns = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
  base: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(toastFns.base, {
    error: toastFns.error,
    success: toastFns.success,
    message: toastFns.message,
  }),
}));

import { __resetReduceMotionForTests, setReduceMotionSwitch } from "../../../motion/roadmapMotion";
import { BuildMenu } from "../components/BuildMenu";
import { PersonChip } from "../components/PeopleChips";
import { ShippedCard } from "../components/ShippedCard";
import { SlideToConfirm } from "../components/SlideToConfirm";
import { shortPrompt } from "../utils/claudeCode";

const item = (overrides: Partial<RoadmapItemDetail> = {}): RoadmapItemDetail => ({
  id: "opp-uuid-388",
  code: "OPP-0388",
  title: "Streak on start screen",
  shownStage: "planning",
  statusParts: {
    stage: "planning",
    step: "ready",
    leadUserId: 2,
    prdPercent: 100,
    openQuestions: 0,
    designAwaitingApproval: false,
    externalBuild: null,
  },
  author: { id: 1, name: "Ravi", role: "idea", ideasShipped: 3 },
  lead: { id: 2, name: "Priya", role: "builder" },
  votes: 23,
  votedByMe: false,
  starred: false,
  unread: false,
  updatedAt: "2026-11-10T00:00:00Z",
  stageSince: "2026-11-10T00:00:00Z",
  summary: {},
  sessionId: "sess-1",
  runs: [],
  prs: [],
  releases: [],
  people: [
    { id: 1, name: "Ravi", role: "idea" },
    { id: 2, name: "Priya", role: "builder" },
  ],
  can: { startBuild: true, exportBrief: true },
  watchLevel: "all",
  ...overrides,
});

const brief = (overrides: Partial<RoadmapBuildBrief> = {}): RoadmapBuildBrief => ({
  code: "OPP-0388",
  markdown: "# OPP-0388: Streak on start screen\n\n## Problem\nLearners forget to come back.",
  length: 70,
  fitsDeepLink: true,
  filename: "OPP-0388-brief.md",
  branch: "opp-0388-streak-on-start-screen",
  prTitle: "OPP-0388: Streak on start screen",
  ...overrides,
});

const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockSettings = { enabled: true };
  mockFetchBrief.mockReturnValue({ unwrap: () => Promise.resolve(brief()) });
  mockRecordSent.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  Object.defineProperty(window, "location", {
    value: { href: "", origin: "http://localhost" },
    writable: true,
  });
});
afterEach(() => {
  Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  __resetReduceMotionForTests();
});

const renderMenu = (props: Partial<React.ComponentProps<typeof BuildMenu>> = {}) =>
  render(
    <MemoryRouter>
      <BuildMenu item={item()} {...props} />
    </MemoryRouter>,
  );

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Build" }));

describe("Build ▾", () => {
  it("lists Build here, Open in Claude Code and the brief actions", () => {
    renderMenu();
    openMenu();
    const items = screen.getAllByRole("menuitem").map(el => el.textContent);
    expect(items[0]).toMatch(/^Build here/);
    expect(items.join("|")).toMatch(
      /Open in Claude Code.*Copy brief.*Download brief.*Preview brief/,
    );
  });

  it("asks for the folder once, then opens Claude Code and records Brief sent", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Open in Claude Code/ }));
    const input = await screen.findByLabelText("Folder");
    fireEvent.change(input, { target: { value: "/Users/me/ally-platform" } });
    const save = screen
      .getAllByRole("button", { name: "Open in Claude Code" })
      .find(el => el.closest(".cds--modal"));
    fireEvent.click(save!);
    await waitFor(() => expect(mockRecordSent).toHaveBeenCalledWith("OPP-0388"));
    expect(window.location.href).toMatch(/^claude:\/\/code\/new\?q=/);
    expect(window.location.href).toContain("folder=%2FUsers%2Fme%2Fally-platform");
    expect(window.localStorage.getItem("ally.roadmap.claudeCodeFolder")).toBe(
      JSON.stringify("/Users/me/ally-platform"),
    );

    // Second time: no folder question.
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Open in Claude Code/ }));
    await waitFor(() => expect(mockRecordSent).toHaveBeenCalledTimes(2));
  });

  it("copies the brief exactly as the server wrote it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy brief/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(brief().markdown));
    expect(mockRecordSent).not.toHaveBeenCalled();
  });

  it("previews exactly what leaves the page", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Preview brief/ }));
    expect(await screen.findByTestId("roadmap-brief-preview")).toHaveTextContent(
      "Learners forget to come back.",
    );
  });

  it("disables Build here with the reason while builds are paused; Open in Claude Code still works", () => {
    mockSettings = { enabled: false };
    renderMenu();
    openMenu();
    const buildHere = screen.getByRole("menuitem", { name: /Build here/ });
    expect(buildHere).toBeDisabled();
    expect(buildHere).toHaveTextContent("Builds are paused by an Owner");
    expect(screen.getByRole("menuitem", { name: /Open in Claude Code/ })).not.toBeDisabled();
  });

  it("asks before building here once the brief went to Claude Code", () => {
    renderMenu({
      item: item({
        statusParts: {
          stage: "planning",
          step: "ready",
          leadUserId: 2,
          prdPercent: 100,
          openQuestions: 0,
          designAwaitingApproval: false,
          externalBuild: { byUserId: 2, at: "2026-11-16T00:00:00Z" },
        },
      }),
    });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Build here/ }));
    expect(screen.getByText(/Priya sent the brief to Claude Code/)).toBeInTheDocument();
    expect(screen.queryByTestId("start-build-dialog")).not.toBeInTheDocument();
  });

  it("on a phone, shows the hint instead of Open in Claude Code", () => {
    renderMenu({ phone: true });
    openMenu();
    expect(screen.queryByRole("menuitem", { name: /Open in Claude Code/ })).not.toBeInTheDocument();
    expect(screen.getByText(/needs the desktop app/)).toBeInTheDocument();
  });

  it("renders nothing for someone with neither right", () => {
    const { container } = renderMenu({ item: item({ can: {} }) });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("brief allowlist, on this side (D18)", () => {
  it("the short prompt carries only code, file, branch and PR title, never anything else", () => {
    const withForbidden = {
      ...brief({ fitsDeepLink: false }),
      strategy: "SECRET STRATEGY",
      spend: { spentUsd: 42 },
      transcript: "TRANSCRIPT",
      declineReason: "DECLINED",
      whyRanks: "RANK REASON",
    } as unknown as RoadmapBuildBrief;
    const prompt = shortPrompt(withForbidden);
    for (const forbidden of ["SECRET", "42", "TRANSCRIPT", "DECLINED", "RANK"]) {
      expect(prompt).not.toContain(forbidden);
    }
  });
});

const shipped = (overrides: Partial<RoadmapItemDetail> = {}) =>
  item({
    shownStage: "shipped",
    statusParts: {
      stage: "shipped",
      step: "measuring",
      liveSince: "2026-11-03T10:00:00Z",
      outcomeReviewAt: null,
      outcome: null,
    },
    releases: [
      { service: "be", state: "live", releasedAt: "2026-11-03T10:00:00Z", repo: "r", prNumber: 1 },
    ],
    outcome: { review: { verdict: "hit", observed: "Next-day return went from 41% to 52%" } },
    ...overrides,
  });

const flush = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)));

describe("Shipped card (§4.14, §4.18)", () => {
  it("bursts confetti once, for the author only", async () => {
    const { unmount } = render(<ShippedCard item={shipped()} currentUserId={1} />);
    await flush();
    expect(mockConfetti).toHaveBeenCalledTimes(1);
    expect(mockConfetti.mock.calls[0][0]).toMatchObject({ particleCount: 40 });
    unmount();
    render(<ShippedCard item={shipped()} currentUserId={1} />);
    await flush();
    expect(mockConfetti).toHaveBeenCalledTimes(1);
  });

  it("shows voters the same card without confetti", async () => {
    render(<ShippedCard item={shipped()} currentUserId={99} />);
    await flush();
    expect(screen.getByTestId("roadmap-shipped-card")).toBeInTheDocument();
    expect(mockConfetti).not.toHaveBeenCalled();
  });

  it("with Reduce motion: no confetti, and every fact still shows", async () => {
    setReduceMotionSwitch(true);
    render(<ShippedCard item={shipped()} currentUserId={1} />);
    await flush();
    expect(mockConfetti).not.toHaveBeenCalled();
    const card = screen.getByTestId("roadmap-shipped-card");
    expect(card).toHaveTextContent("Shipped!");
    expect(card).toHaveTextContent("Live since 3 Nov in Backend");
    expect(card).toHaveTextContent("▲23 people backed this");
    expect(card).toHaveTextContent("Hit target: Next-day return went from 41% to 52%");
    // It still counts as seen: turning motion back on later doesn't replay it.
    __resetReduceMotionForTests();
    render(<ShippedCard item={shipped()} currentUserId={1} />);
    await flush();
    expect(mockConfetti).not.toHaveBeenCalled();
  });

  it("is absent before an idea ships", () => {
    const { container } = render(<ShippedCard item={item()} currentUserId={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("people chips and slide to confirm", () => {
  it("shows ideas shipped for a person with some, and nothing for zero", () => {
    const { rerender } = render(
      <PersonChip person={{ id: 1, name: "Ravi", role: "idea", ideasShipped: 3 }} />,
    );
    const chip = screen.getByRole("button", { name: "Ravi" });
    expect(chip).toHaveAccessibleDescription("ideas shipped: 3");
    rerender(<PersonChip person={{ id: 2, name: "Ana", role: "idea", ideasShipped: 0 }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
  });

  it("confirms from the keyboard, never from a tap", () => {
    const onConfirm = vi.fn();
    render(
      <SlideToConfirm label="Slide to release" doneLabel="Releasing…" onConfirm={onConfirm} />,
    );
    const thumb = screen.getByRole("button", { name: "Slide to release" });
    fireEvent.click(thumb);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Releasing…")).toBeInTheDocument();
  });
});
