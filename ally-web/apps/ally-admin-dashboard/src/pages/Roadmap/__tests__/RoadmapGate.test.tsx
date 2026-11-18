import "@constants";
import React from "react";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRole = vi.fn();

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapMeRoleQuery: () => mockRole(),
}));

import { RoadmapGate, useRoadmapRole } from "../RoadmapGate";

const Role: React.FC = () => <p>role:{useRoadmapRole().role}</p>;

describe("RoadmapGate", () => {
  beforeEach(() => mockRole.mockReset());

  it("shows the fallback while roadmap_v2 is off (the role read 404s)", () => {
    mockRole.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(
      <RoadmapGate fallback={<p>not found</p>}>
        <Role />
      </RoadmapGate>,
    );
    expect(screen.getByText("not found")).toBeInTheDocument();
    expect(screen.queryByText(/role:/)).toBeNull();
  });

  it("shows the fallback for someone with no Roadmap role", () => {
    mockRole.mockReturnValue({ isLoading: false, isError: false, data: { role: "none", can: {} } });
    render(
      <RoadmapGate fallback={<p>not found</p>}>
        <Role />
      </RoadmapGate>,
    );
    expect(screen.getByText("not found")).toBeInTheDocument();
  });

  it("renders the page with the caller's role when the flag is on", () => {
    mockRole.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { role: "builder", can: {} },
    });
    render(
      <RoadmapGate fallback={<p>not found</p>}>
        <Role />
      </RoadmapGate>,
    );
    expect(screen.getByText("role:builder")).toBeInTheDocument();
  });
});
