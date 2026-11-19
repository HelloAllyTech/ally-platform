import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi, describe, it, expect } from "vitest";

import { TrackItemNode } from "./TrackItemNode";
import { TrackDetailItem, TrackItemStatus, TrackItemType } from "@types";

const mockItem: TrackDetailItem = {
  id: "1",
  title: "Test Item",
  status: TrackItemStatus.LOCKED,
  type: TrackItemType.ARTICLE,
  order: 1,
  startedAt: null,
  completedAt: null,
  languageCode: "en",
  languageIsOriginal: true,
};

describe("TrackItemNode", () => {
  it("renders as a non-interactive element when locked", () => {
    const handleClick = vi.fn();
    render(<TrackItemNode item={mockItem} index={0} isNext={false} onClick={handleClick} />);

    const element = screen.getByLabelText(mockItem.title);
    expect(element.tagName).not.toBe("BUTTON");
  });

  it("does not call onClick when locked and clicked", () => {
    const handleClick = vi.fn();
    render(
      <TrackItemNode
        item={{ ...mockItem, status: TrackItemStatus.LOCKED }}
        index={0}
        isNext={false}
        onClick={handleClick}
      />,
    );

    // Even if it's not a button, it might be inside a clickable element.
    // We select by title which should be the aria-label.
    const element = screen.getByLabelText(mockItem.title);
    fireEvent.click(element);

    expect(handleClick).not.toHaveBeenCalled();
  });

  it("renders as a button and is clickable when unlocked", () => {
    const handleClick = vi.fn();
    render(
      <TrackItemNode
        item={{ ...mockItem, status: TrackItemStatus.UNLOCKED }}
        index={0}
        isNext={false}
        onClick={handleClick}
      />,
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  describe("blocker reason", () => {
    const LocationProbe = () => <div data-testid="loc">{useLocation().pathname}</div>;
    const renderBlocked = (blockedBy: TrackDetailItem["blockedBy"], onClick = vi.fn()) =>
      render(
        <MemoryRouter initialEntries={["/track/t1"]}>
          <Routes>
            <Route
              path="/track/:trackId"
              element={
                <TrackItemNode
                  item={{ ...mockItem, blockedBy }}
                  index={0}
                  isNext={false}
                  onClick={onClick}
                />
              }
            />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );

    const base = {
      itemId: "prev1",
      title: "Prev Quiz",
      type: "QUIZ",
      reasons: [{ code: "BELOW_SCORE" as const, actual: 40, required: 70 }],
    };

    it("shows the specific line and a Try again link that opens the blocking item", () => {
      const onClick = vi.fn();
      renderBlocked({ ...base, action: "RETRY" }, onClick);
      expect(screen.getByText(/Prev Quiz.*you scored 40%, need 70%/)).toBeTruthy();
      expect(screen.queryByText("Complete the previous items to unlock this")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.getByTestId("loc").textContent).toBe("/track/t1/item/prev1");
      expect(onClick).not.toHaveBeenCalled();
    });

    it("OPEN action shows Go to item", () => {
      renderBlocked({ ...base, action: "OPEN" });
      expect(screen.getByRole("button", { name: "Go to item" })).toBeTruthy();
    });

    it("NONE action shows no link", () => {
      renderBlocked({ ...base, action: "NONE" });
      expect(screen.getByText(/you scored 40%/)).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("without blockedBy keeps the generic line", () => {
      renderBlocked(null);
      expect(screen.getByText("Complete the previous items to unlock this")).toBeTruthy();
    });
  });
});
