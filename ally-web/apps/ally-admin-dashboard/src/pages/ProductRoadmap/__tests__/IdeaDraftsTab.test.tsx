import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const drafts = vi.hoisted(() => ({ items: [] as any[] }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@ally-ui-mono/ui-shared", () => ({ SkeletonText: () => <div>loading</div> }));
vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: any) => <div>{title}</div>,
  ActionConfirmationPopup: () => null,
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "p", SECONDARY: "s", TEXT: "t", DESTRUCTIVE: "d" },
}));
vi.mock("@api", () => ({
  useGetRoadmapIdeaDraftsQuery: () => ({
    data: { items: drafts.items, count: drafts.items.length },
    isLoading: false,
  }),
  useUpdateRoadmapIdeaDraftMutation: () => [vi.fn(), { isLoading: false }],
  useDeleteRoadmapIdeaDraftMutation: () => [vi.fn(), { isLoading: false }],
}));

import { IdeaDraftsTab } from "../IdeaDraftsTab";

const draft = {
  id: "d1",
  rawText: "What if call notes wrote themselves?",
  captureMode: "voice",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("IdeaDraftsTab", () => {
  it("shows an empty state with no drafts", () => {
    drafts.items = [];
    render(<IdeaDraftsTab onContinue={vi.fn()} />);
    expect(screen.getByText("No saved ideas yet")).toBeInTheDocument();
  });

  it("lists the raw idea and continues from that exact draft", () => {
    drafts.items = [draft];
    const onContinue = vi.fn();
    render(<IdeaDraftsTab onContinue={onContinue} />);

    expect(screen.getByText(draft.rawText)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with copilot" }));
    expect(onContinue).toHaveBeenCalledWith(draft);
  });
});
