import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoadmapOpportunity } from "@types";

const mockSetStar = vi.fn();

vi.mock("@api", () => ({
  useSetRoadmapDirectorStarMutation: () => [mockSetStar, { isLoading: false }],
}));
vi.mock("@icons", () => ({
  StarOutline: () => <span>outline</span>,
  StarSolid: () => <span>solid</span>,
}));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { DirectorStarButton } from "../DirectorStarButton";

const opp = (directorStarred: boolean | null | undefined) =>
  ({ id: "opp-1", directorStarred }) as unknown as RoadmapOpportunity;

describe("DirectorStarButton", () => {
  beforeEach(() => {
    mockSetStar.mockReset();
    mockSetStar.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("renders nothing for anyone but the director (null)", () => {
    const { container } = render(<DirectorStarButton opportunity={opp(null)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the field is absent", () => {
    const { container } = render(<DirectorStarButton opportunity={opp(undefined)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stars an unstarred opportunity on click", async () => {
    render(<DirectorStarButton opportunity={opp(false)} />);
    fireEvent.click(screen.getByTestId("director-star"));
    await waitFor(() => expect(mockSetStar).toHaveBeenCalledWith({ id: "opp-1", starred: true }));
  });

  it("clears an existing star on click", async () => {
    render(<DirectorStarButton opportunity={opp(true)} />);
    expect(screen.getByTestId("director-star")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("director-star"));
    await waitFor(() => expect(mockSetStar).toHaveBeenCalledWith({ id: "opp-1", starred: false }));
  });
});
