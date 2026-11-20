import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefPinnedRulesQuery: () => ({
    data: {
      rules: [
        {
          code: "debrief_safety_reader_system",
          label: "Safety rules",
          version: 2,
          promptId: "p1",
          updatedAt: "2026-11-12T10:00:00Z",
          updatedBy: { id: 7, name: "Asha" },
        },
        {
          code: "debrief_quality_rubric",
          label: "Rubric (the Evaluator and the judge score by it)",
          version: 1,
          promptId: "p2",
          updatedAt: null,
          updatedBy: null,
        },
      ],
    },
  }),
}));

/* eslint-disable import/first */
import { PinnedRulesSection } from "../settings/PinnedRulesSection";
/* eslint-enable import/first */

describe("Settings › Locked prompts (read-only)", () => {
  const renderIt = () =>
    render(
      <MemoryRouter>
        <PinnedRulesSection />
      </MemoryRouter>,
    );

  it("lists each rule with its version and who last changed it, or that engineering wrote it", () => {
    renderIt();
    expect(screen.getByText("Safety rules")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText(/^Last changed by Asha/)).toBeInTheDocument();
    expect(screen.getByText("Written by engineering")).toBeInTheDocument();
  });

  it("has no way to ask for or approve a change, only a link to the Skills Store", () => {
    renderIt();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Ask for a change|Approved by/)).toBeNull();
    const links = screen.getAllByRole("link", { name: "Open in Skills Store" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/manage-prompts");
  });
});
