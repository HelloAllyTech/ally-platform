import "@constants";
import React from "react";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const refetch = vi.fn();
const runsHook = vi.fn();
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetManualRunsQuery: (...args: unknown[]) => runsHook(...args),
  useRunManualAgentNowMutation: () => [vi.fn(), { isLoading: false }],
}));

import { RunsSection } from "../components/AdminDrawer";
import { MANUAL_RUN_POLL_MS } from "../components/StateBanner";

const copy = en.productManual.admin;

const run = (status: string) => ({
  id: "r1",
  trigger: "manual",
  status,
  stopReason: null,
  spentUsd: 0.2,
  reservedUsd: 0,
  pagesTouched: 7,
  proposalsApplied: 0,
  summary: null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
});

beforeEach(() => {
  refetch.mockReset();
  runsHook.mockReset();
  runsHook.mockReturnValue({ data: [run("running")], isLoading: false, refetch });
});

describe("RunsSection live refresh", () => {
  it("polls the run list every few seconds while a run is going, and reads fresh on open", () => {
    render(<RunsSection running />);
    const options = runsHook.mock.calls[0][1];
    expect(options.pollingInterval).toBe(MANUAL_RUN_POLL_MS);
    expect(options.refetchOnMountOrArgChange).toBe(true);
    expect(options.skipPollingIfUnfocused).toBe(true);
    expect(screen.getByText(copy.running)).toBeTruthy();
  });

  it("does not poll while nothing is running", () => {
    render(<RunsSection running={false} />);
    expect(runsHook.mock.calls[0][1].pollingInterval).toBe(0);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("reads the list once more when the run stops, so it cannot stay on 'running'", () => {
    const { rerender } = render(<RunsSection running />);
    expect(refetch).not.toHaveBeenCalled();
    rerender(<RunsSection running={false} />);
    expect(refetch).toHaveBeenCalledTimes(1);
    rerender(<RunsSection running={false} />);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
