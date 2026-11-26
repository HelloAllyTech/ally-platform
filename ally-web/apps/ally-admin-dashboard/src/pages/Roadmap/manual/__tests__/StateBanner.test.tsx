import "@constants";
import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { ManualState } from "@types";

import { StateBanner, StateFooter, lastCheckedAt } from "../components/StateBanner";
import { starterPrompts } from "../components/ChatPanel";

const state = (overrides: Partial<ManualState> = {}): ManualState => ({
  agentState: "idle",
  banner: null,
  budget: { monthlyBudgetUsd: 100, spentUsd: 12, reservedUsd: 0 },
  lastRun: { finishedAt: new Date().toISOString() },
  nextRunAt: null,
  openProposals: 0,
  openGaps: 0,
  analyticsAvailable: false,
  canAdminister: false,
  ...overrides,
});

describe("StateBanner", () => {
  it("is quiet when there is nothing to say", () => {
    const { container } = render(<StateBanner state={state()} />);
    expect(container).toBeEmptyDOMElement();
    render(<StateBanner state={undefined} />);
  });

  it("shows the server's sentence when updates are paused", () => {
    render(
      <StateBanner
        state={state({
          agentState: "budget_exhausted",
          banner: "Weekly updates are paused: this month's budget is spent.",
        })}
      />,
    );
    expect(
      screen.getByText("Weekly updates are paused: this month's budget is spent."),
    ).toBeInTheDocument();
  });
});

describe("StateFooter", () => {
  it("says when the manual was last checked", () => {
    render(<StateFooter state={state()} />);
    expect(screen.getByText(en.productManual.state.lastChecked("just now"))).toBeInTheDocument();
    expect(lastCheckedAt(state({ lastRun: null }))).toBeNull();
  });

  it("shows open gaps only to people who run the manual", () => {
    const onOpenGaps = vi.fn();
    const { rerender } = render(
      <StateFooter state={state({ openGaps: 3 })} onOpenGaps={onOpenGaps} />,
    );
    expect(screen.queryByText(en.productManual.state.gaps(3))).toBeNull();
    rerender(
      <StateFooter state={state({ openGaps: 3, canAdminister: true })} onOpenGaps={onOpenGaps} />,
    );
    fireEvent.click(screen.getByText(en.productManual.state.gaps(3)));
    expect(onOpenGaps).toHaveBeenCalled();
  });
});

describe("starterPrompts", () => {
  it("offers the usage prompt only when the Analytics Agent is available", () => {
    const chat = en.productManual.chat;
    expect(starterPrompts(false)).not.toContain(chat.usageStarter);
    expect(starterPrompts(true)).toContain(chat.usageStarter);
    expect(starterPrompts(true)).toHaveLength(4);
  });
});
