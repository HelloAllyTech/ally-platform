import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderPrinciples } from "@types";

const { toastFn } = vi.hoisted(() => ({
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@hooks", () => ({}));
vi.mock("@utils", () => ({}));
vi.mock("@components", () => ({ cellTypes: {} }));

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  isError: false,
  setOff: vi.fn(),
  queryArgs: [] as unknown[],
}));

vi.mock("@api", () => ({
  useGetBuilderPrinciplesQuery: (...args: unknown[]) => {
    mocks.queryArgs = args;
    return { data: mocks.data, isLoading: false, isError: mocks.isError, refetch: vi.fn() };
  },
  useSetBuilderPrinciplesOffMutation: () => [
    (...args: unknown[]) => ({ unwrap: () => Promise.resolve(mocks.setOff(...args)) }),
    { isLoading: false },
  ],
}));

import { PrinciplesInPlay } from "../PrinciplesInPlay";

const principles = (over: Partial<BuilderPrinciples> = {}): BuilderPrinciples => ({
  enabled: true,
  off: false,
  briefReady: true,
  descriptor: "A calmer first screen for new counsellors",
  items: [
    {
      code: "FP-0001",
      statement: "Show the payoff, not the pipeline.",
      collectionId: "first_principles",
      prdSections: ["goals"],
      probe: "What does someone see first?",
      status: "applied",
      inBrief: true,
    },
    {
      code: "FP-0002",
      statement: "Ask one question at a time.",
      collectionId: "first_principles",
      prdSections: [],
      probe: null,
      status: "trade_off",
      inBrief: false,
    },
    {
      code: "FP-0003",
      statement: "Say what changed.",
      collectionId: "first_principles",
      prdSections: [],
      probe: null,
      status: "cited",
      inBrief: false,
    },
    {
      code: "FP-0004",
      statement: "Never ask people to grade.",
      collectionId: "first_principles",
      prdSections: [],
      probe: null,
      status: "open",
      inBrief: false,
    },
  ],
  tensions: [{ a: "FP-0001", b: "FP-0002", note: "Speed against depth." }],
  ...over,
});

const renderPanel = (live = true) =>
  render(
    <MemoryRouter>
      <PrinciplesInPlay sessionId="session-1" live={live} />
    </MemoryRouter>,
  );

describe("PrinciplesInPlay", () => {
  beforeEach(() => {
    mocks.data = principles();
    mocks.isError = false;
    mocks.setOff.mockReset();
    toastFn.mockReset();
    toastFn.error.mockReset();
  });

  it("lists each principle with its status as an icon and a word, and the trade-offs", () => {
    renderPanel();
    const panel = screen.getByTestId("principles-in-play");
    expect(panel).toHaveTextContent("4 in play");
    const statuses = screen.getAllByTestId("principle-status").map(s => s.textContent);
    expect(statuses).toEqual(["Applied", "Trade-off", "Cited", "Open"]);
    screen.getAllByTestId("principle-status").forEach(status => {
      expect(status.querySelector("svg")).not.toBeNull();
    });
    const first = screen.getAllByTestId("principle-item")[0];
    expect(within(first).getByText("Show the payoff, not the pipeline.")).toBeInTheDocument();
    expect(within(first).getByText("In the brief")).toBeInTheDocument();
    expect(
      within(first).getByRole("link", { name: "Open FP-0001 in the Context Library" }),
    ).toHaveAttribute("href", "/context-library?chunk=FP-0001");
    expect(panel).toHaveTextContent("FP-0001 and FP-0002 pull against each other");
    expect(panel).toHaveTextContent("Speed against depth.");
  });

  it("says it is finding principles until the brief is ready, and polls meanwhile", () => {
    mocks.data = principles({ briefReady: false, items: [], tensions: [] });
    renderPanel();
    expect(screen.getByTestId("principles-finding")).toHaveTextContent(
      "Finding principles for this idea…",
    );
    expect(mocks.queryArgs[1]).toEqual(expect.objectContaining({ pollingInterval: 4000 }));
  });

  it("says when principles are off, and never polls a finished session", () => {
    mocks.data = principles({ off: true });
    renderPanel(false);
    expect(screen.getByTestId("principles-in-play")).toHaveTextContent(
      "Principles are off for this session.",
    );
    expect(screen.queryByTestId("principle-item")).not.toBeInTheDocument();
    expect(mocks.queryArgs[1]).toEqual(expect.objectContaining({ pollingInterval: 0 }));
  });

  it("switches principles off for the session at once, and back if the server refuses", async () => {
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Use principles in this session" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(mocks.setOff).toHaveBeenCalledWith({ id: "session-1", off: true });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toastFn).toHaveBeenCalledWith(
      "Principles switched off for this session. The interview carries on without them.",
    );

    mocks.setOff.mockImplementation(() => {
      throw new Error("nope");
    });
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toastFn.error).toHaveBeenCalledWith("That didn't go through. Nothing changed.");
  });

  it("offers a retry when the principles can't be loaded", () => {
    mocks.data = undefined;
    mocks.isError = true;
    renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the principles.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
