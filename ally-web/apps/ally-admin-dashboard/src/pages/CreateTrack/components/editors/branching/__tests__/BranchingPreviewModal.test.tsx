import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BranchingExperience, BranchingScenarioContent } from "@types";

import { BranchingPreviewModal } from "../BranchingPreviewModal";

/** Start (photo) -> one button -> Middle (no photo) -> two choices -> two endings. */
const content = (withPhoto = true): BranchingScenarioContent => ({
  startNodeId: "a",
  nodes: [
    {
      id: "a",
      text: "She sits down.",
      ...(withPhoto ? { image: { url: "https://cdn.test/a.jpg", alt: "A kitchen" } } : {}),
      choices: [{ id: "c1", text: "Keep listening", nextNodeId: "b" }],
    },
    {
      id: "b",
      text: "She goes quiet.",
      choices: [
        { id: "c2", text: "Wait", nextNodeId: "c" },
        { id: "c3", text: "Fill the silence", nextNodeId: "d" },
      ],
    },
    { id: "c", text: "Good ending", outcome: "POSITIVE" },
    { id: "d", text: "Bad ending", outcome: "NEGATIVE" },
  ],
});

describe("BranchingPreviewModal", () => {
  it("shows a one-choice scene as a single button that moves on", () => {
    render(<BranchingPreviewModal content={content()} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Keep listening" });
    expect(button.className).toContain("rounded-full");
    expect(button.className).toContain("bg-primary-500");
    fireEvent.click(button);
    expect(screen.getByText("She goes quiet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wait" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fill the silence" })).toBeInTheDocument();
  });

  it("in Story mode reuses the photo from the scene before", () => {
    render(
      <BranchingPreviewModal
        content={{ ...content(), experience: BranchingExperience.STORY }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "A kitchen" })).toHaveAttribute(
      "src",
      "https://cdn.test/a.jpg",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep listening" }));
    expect(screen.getByText("She goes quiet.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A kitchen" })).toBeInTheDocument();
  });

  it("falls back to Classic when a Story scenario has no photos", () => {
    render(
      <BranchingPreviewModal
        content={{ ...content(false), experience: BranchingExperience.STORY }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("dialog").className).toContain("max-w-[560px]");
  });
});
