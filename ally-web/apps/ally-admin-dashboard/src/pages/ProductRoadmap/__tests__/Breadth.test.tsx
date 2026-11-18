import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoadmapBreadth, RoadmapBreadthRow } from "@types";

import { BreadthBadge, BreadthReadout, dropWarning } from "../BreadthBadge";
import { bandRows } from "../BreadthPanel";

vi.mock("@api", () => ({ useGetRoadmapBreadthEveryoneQuery: () => ({ data: [] }) }));
vi.mock("@components", () => ({
  Button: (p: { children: React.ReactNode }) => <button>{p.children}</button>,
}));
vi.mock("@components/types", () => ({ ButtonVariant: { TEXT: "text" } }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const breadth = (over: Partial<RoadmapBreadth> = {}): RoadmapBreadth => ({
  enabled: true,
  multiplier: 1.15,
  qualifying: 4,
  target: 8,
  windowDays: 14,
  maxMultiplier: 1.3,
  nextDropAt: null,
  nextDropMultiplier: null,
  nextDropAuthorName: null,
  ...over,
});

describe("BreadthBadge", () => {
  it("shows the multiplier with an accessible name that says how it was earned", () => {
    render(<BreadthBadge breadth={breadth()} availableVotes={12} onClick={() => {}} />);
    const button = screen.getByRole("button", {
      name: "Breadth multiplier 1.15, 4 of 8 colleagues",
    });
    expect(button).toHaveTextContent("×1.15");
  });

  it("shows ×1.0 in the same neutral badge rather than hiding it", () => {
    render(
      <BreadthBadge
        breadth={breadth({ multiplier: 1, qualifying: 0 })}
        availableVotes={0}
        onClick={() => {}}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("×1.0");
  });

  it("shows a skeleton, never a premature ×1.0, while loading", () => {
    render(<BreadthBadge breadth={undefined} availableVotes={undefined} onClick={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("×–")).toBeInTheDocument();
  });

  it("toggles the readout when clicked", () => {
    const onClick = vi.fn();
    render(<BreadthBadge breadth={breadth()} availableVotes={3} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("BreadthReadout", () => {
  it("states the progress, exposes a progressbar and links to everyone's breadth", () => {
    const onSeeEveryone = vi.fn();
    render(
      <BreadthReadout
        breadth={breadth()}
        isError={false}
        onRetry={() => {}}
        onSeeEveryone={onSeeEveryone}
      />,
    );
    expect(screen.getByText(/Breadth ×1\.15/)).toBeInTheDocument();
    expect(screen.getByText(/4 of 8 colleagues/)).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
    fireEvent.click(screen.getByText("See everyone's breadth"));
    expect(onSeeEveryone).toHaveBeenCalled();
  });

  it("says what to do to raise it, up to the ceiling", () => {
    render(
      <BreadthReadout
        breadth={breadth()}
        isError={false}
        onRetry={() => {}}
        onSeeEveryone={() => {}}
      />,
    );
    expect(screen.getByText(/up to ×1\.3/)).toBeInTheDocument();
  });

  it("offers a retry on error", () => {
    const onRetry = vi.fn();
    render(
      <BreadthReadout breadth={undefined} isError onRetry={onRetry} onSeeEveryone={() => {}} />,
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("dropWarning", () => {
  it("is null when nothing is due", () => {
    expect(dropWarning(breadth())).toBeNull();
  });
  it("names the colleague whose vote is ageing out", () => {
    const text = dropWarning(
      breadth({
        nextDropAt: "2026-11-14T10:00:00.000Z",
        nextDropMultiplier: 1.11,
        nextDropAuthorName: "Priya",
      }),
    );
    expect(text).toMatch(
      /^Drops to ×1\.11 on 14 Nov when your vote on Priya's opportunity ages out\.$/,
    );
  });
});

describe("bandRows", () => {
  const row = (userId: number, name: string, multiplier: number): RoadmapBreadthRow => ({
    userId,
    name,
    multiplier,
    qualifying: 0,
    target: 8,
  });

  it("groups into bands, alphabetical inside a band, dropping empty bands", () => {
    const bands = bandRows([
      row(1, "Zed", 1.3),
      row(2, "Asha", 1.22),
      row(3, "Mina", 1.0),
      row(4, "Bo", 1.12),
    ]);
    expect(bands.map(b => b.label)).toEqual(["Wide", "Building", "Getting started"]);
    expect(bands[0].rows.map(r => r.name)).toEqual(["Asha", "Zed"]);
  });

  it("omits a band with no one in it", () => {
    expect(bandRows([row(1, "Asha", 1.0)]).map(b => b.label)).toEqual(["Getting started"]);
  });
});
