import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
