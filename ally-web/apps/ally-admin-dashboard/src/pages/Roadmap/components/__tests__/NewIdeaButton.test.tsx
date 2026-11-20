import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { NewIdeaButton } from "../NewIdeaButton";

vi.mock("@components/idea-capture/IdeaCapture", () => ({
  IdeaCaptureLauncher: () => null,
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useCreateRoadmapBugReportMutation: () => [vi.fn()],
  useGetBugFindingsQuery: () => ({ data: undefined }),
}));

describe("NewIdeaButton", () => {
  it("opens the bug report form full-screen in place, and closes it again", () => {
    render(
      <MemoryRouter initialEntries={["/roadmap?view=todo"]}>
        <NewIdeaButton />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/what were you trying to do/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /report a bug/i }));

    expect(screen.getByTestId("bug-report-form-full-screen")).toBeInTheDocument();
    expect(screen.getByLabelText(/what were you trying to do/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByLabelText(/what were you trying to do/i)).not.toBeInTheDocument();
  });
});
