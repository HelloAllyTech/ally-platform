import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeSafety } from "@types";

/**
 * "This isn't right for my business" (Q3-fast Part 1, C10): the owner corrects a pack chosen for
 * the wrong kind of business. A stricter or equal pack changes at once; a less strict one asks why.
 */
const h = vi.hoisted(() => ({ change: vi.fn() }));

vi.mock("@api", () => ({
  useChangeOwnRuleMutation: () => [vi.fn(), { isLoading: false }],
  useChangeSafetyPackMutation: () => [
    (arg: unknown) => ({ unwrap: () => Promise.resolve(h.change(arg)) }),
    { isLoading: false },
  ],
}));

const { PackChooser, packChangeLine } = await import("../sections/Safety");
const { HOME } = await import("../copy");
const t = HOME.safety;

const safety: HomeSafety = {
  pack: {
    id: "minors",
    name: "Care for young people",
    industryLabel: "services for young people",
    always: [],
    never: [],
    atRisk: [],
  },
  rules: [],
  version: "v1",
  choices: [
    { id: "mental_health", name: "Mental health safety", summary: "Therapy…", lessStrict: false },
    { id: "medical", name: "Medical safety", summary: "Clinics…", lessStrict: false },
    { id: "minors", name: "Care for young people", summary: "Schools…", lessStrict: false },
    { id: "standard", name: "Facts only", summary: "Every assistant…", lessStrict: true },
  ],
};

describe("PackChooser", () => {
  beforeEach(() => h.change.mockReset());

  const open = () => {
    render(<PackChooser botId="bot-1" safety={safety} />);
    fireEvent.click(screen.getByRole("button", { name: t.notRight }));
  };

  it("offers every other pack, marking the less strict one", () => {
    open();
    expect(screen.getByLabelText(/Medical safety/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Facts only/)).toHaveAccessibleName(/Less strict/);
  });

  // TF1 round 2 (Sahyog P2): it opened with nothing selected.
  it("opens on the pack in use, and changes nothing until another is picked", () => {
    open();
    const current = screen.getByLabelText(/Care for young people/);
    expect(current).toBeChecked();
    expect(current).toHaveAccessibleName(/In use now/);
    expect(screen.getByRole("button", { name: t.change })).toBeDisabled();
  });

  it("changes to a stricter pack at once, with no reason", async () => {
    open();
    fireEvent.click(screen.getByLabelText(/Medical safety/));
    expect(screen.queryByLabelText(t.reasonLabel)).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.change }));
    });
    expect(h.change).toHaveBeenCalledWith({ id: "bot-1", pack: "medical" });
  });

  it("asks why before a less strict pack, and sends the reason", async () => {
    open();
    fireEvent.click(screen.getByLabelText(/Facts only/));
    const submit = screen.getByRole("button", { name: t.change });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(t.reasonLabel), { target: { value: "too short" } });
    expect(submit).toBeDisabled();
    expect(screen.getByText(t.reasonShort)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t.reasonLabel), {
      target: { value: "We're a restaurant, not a school." },
    });
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(h.change).toHaveBeenCalledWith({
      id: "bot-1",
      pack: "standard",
      reason: "We're a restaurant, not a school.",
    });
  });
});

describe("packChangeLine", () => {
  it("says when the owner changed it, with the reason for a less strict pack", () => {
    expect(packChangeLine(null)).toBeNull();
    expect(
      packChangeLine({
        from: "minors",
        to: "medical",
        reason: null,
        lessStrict: false,
        at: "2026-11-18T09:00:00Z",
      }),
    ).toBe("Safety rules changed by you on 18 Nov 2026.");
    expect(
      packChangeLine({
        from: "minors",
        to: "standard",
        reason: "We're a restaurant.",
        lessStrict: true,
        at: "2026-11-18T09:00:00Z",
      }),
    ).toBe("Safety rules changed by you on 18 Nov 2026: “We're a restaurant.”");
  });
});
