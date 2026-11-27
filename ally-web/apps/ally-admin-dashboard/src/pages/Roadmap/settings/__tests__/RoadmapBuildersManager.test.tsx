import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoadmapRoleEntry } from "@types";

import { RoadmapBuildersManager } from "../RoadmapBuildersManager";

const setRole = vi.fn();
let users: RoadmapRoleEntry[] = [];

const entry = (over: Partial<RoadmapRoleEntry> & { userId: number; name: string }) =>
  ({ role: "idea", restricted: false, setting: "idea", ...over }) as RoadmapRoleEntry;

vi.mock("@api", () => ({
  useListRoadmapRolesQuery: () => ({ data: { users }, isLoading: false, isError: false }),
  useSetRoadmapRoleForMutation: () => [setRole],
}));

// The `@utils` barrel reaches `loggerWithRedux` -> `@store`, which reads `baseAPI.reducerPath` at
// import time, so a test that stubs `@api` has to stub the store too.
vi.mock("@store", () => ({ store: {} }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// Carbon's filterable list is a combobox; these stand in for the few components used, one button
// per option, so the test is about what the screen does with a choice, not about driving Downshift.
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  InlineNotification: ({ title }: any) => <div role="alert">{title}</div>,
  SkeletonText: () => <div />,
  Tooltip: ({ children }: any) => <>{children}</>,
  Modal: ({ open, modalHeading, primaryButtonText, onRequestSubmit, children }: any) =>
    open ? (
      <div role="dialog" aria-label={modalHeading}>
        {children}
        <button onClick={onRequestSubmit}>{primaryButtonText}</button>
      </div>
    ) : null,
  FilterableMultiSelect: ({ items, selectedItems, onChange }: any) => (
    <div>
      {items.map((item: { id: number; label: string }) => {
        const on = selectedItems.some((s: { id: number }) => s.id === item.id);
        return (
          <button
            key={item.id}
            aria-pressed={on}
            onClick={() =>
              onChange({
                selectedItems: on
                  ? selectedItems.filter((s: { id: number }) => s.id !== item.id)
                  : [...selectedItems, item],
              })
            }
          >
            {item.label}
          </button>
        );
      })}
    </div>
  ),
}));

describe("RoadmapBuildersManager", () => {
  beforeEach(() => {
    setRole.mockReset();
    setRole.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    users = [
      entry({ userId: 1, name: "Owen Owner", setting: "owner", role: "owner" }),
      entry({ userId: 2, name: "Bea Builder", setting: "builder", role: "builder" }),
      entry({ userId: 3, name: "Ida Idea" }),
      entry({ userId: 4, name: "Rex Restricted", restricted: true, role: "viewer" }),
    ];
  });

  it("starts with today's builders chosen, and Save disabled until something changes", () => {
    render(<RoadmapBuildersManager />);

    expect(screen.getByText("Bea Builder")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Ida Idea")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Save builders" })).toBeDisabled();
  });

  it("lists neither Owners nor org-restricted admins as choices, and says why", () => {
    render(<RoadmapBuildersManager />);

    expect(screen.queryByText("Owen Owner", { selector: "button" })).toBeNull();
    expect(screen.queryByText("Rex Restricted")).toBeNull();
    expect(screen.getByText(/Owners always can.*Owen Owner/)).toBeInTheDocument();
    expect(screen.getByText(/1 admin is limited to some organisations/)).toBeInTheDocument();
  });

  it("asks before saving, then makes the added person a builder and sends the removed one back to Idea", async () => {
    render(<RoadmapBuildersManager />);

    fireEvent.click(screen.getByText("Ida Idea"));
    fireEvent.click(screen.getByText("Bea Builder"));
    fireEvent.click(screen.getByRole("button", { name: "Save builders" }));

    expect(screen.getByText(/Give the Builder role to: Ida Idea/)).toBeInTheDocument();
    expect(screen.getByText(/Take the Builder role from: Bea Builder/)).toBeInTheDocument();
    expect(setRole).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setRole).toHaveBeenCalledTimes(2));
    expect(setRole).toHaveBeenCalledWith({ userId: 3, role: "builder" });
    // Idea, never None: they keep seeing and voting on the board.
    expect(setRole).toHaveBeenCalledWith({ userId: 2, role: "idea" });
  });

  it("warns when someone is chosen but can't build yet, instead of looking like it did nothing", () => {
    users = [
      entry({ userId: 5, name: "Shay Stuck", setting: "builder", role: "idea" }),
      entry({ userId: 3, name: "Ida Idea" }),
    ];
    render(<RoadmapBuildersManager />);

    expect(screen.getByText(/can't build yet: Shay Stuck/)).toBeInTheDocument();
  });

  it("tells two people with one name apart by id", () => {
    users = [entry({ userId: 7, name: "Sam Same" }), entry({ userId: 8, name: "Sam Same" })];
    render(<RoadmapBuildersManager />);

    expect(screen.getByText("Sam Same (#7)")).toBeInTheDocument();
    expect(screen.getByText("Sam Same (#8)")).toBeInTheDocument();
  });
});
