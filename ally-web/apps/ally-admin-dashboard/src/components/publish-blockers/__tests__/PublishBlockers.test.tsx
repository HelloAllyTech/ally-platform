import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PublishBlockers } from "../PublishBlockers";

describe("PublishBlockers", () => {
  it("lists blockers with a count", () => {
    render(
      <PublishBlockers
        blockers={[
          { id: "a", message: "Add a scenario" },
          { id: "b", message: "Pick a language" },
        ]}
      />,
    );
    expect(screen.getByText("2 things are blocking publish")).toBeInTheDocument();
    expect(screen.getByText("Add a scenario")).toBeInTheDocument();
  });
  it("shows ready when none", () => {
    render(<PublishBlockers blockers={[]} />);
    expect(screen.getByText(/Ready to publish/)).toBeInTheDocument();
  });
});

describe("PublishBlockers compact", () => {
  it("lists every reason on one line, each with its Fix", () => {
    const onFix = vi.fn();
    render(
      <PublishBlockers
        compact
        blockers={[
          { id: "title", message: 'Fill in "Title"', onFix },
          { id: "voice", message: 'Fill in "Language-Voice"' },
        ]}
      />,
    );
    const line = screen.getByRole("status");
    expect(line.tagName).toBe("P");
    expect(line.textContent).toContain("2 things are blocking publish:");
    expect(line.textContent).toContain('Fill in "Language-Voice"');
    fireEvent.click(screen.getByText("Fix"));
    expect(onFix).toHaveBeenCalled();
  });
});
