import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ page: undefined as unknown }));
const save = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  SkeletonText: () => <div>loading</div>,
  TextArea: ({ id, labelText, value, onChange }: any) => (
    <label>
      {labelText}
      <textarea id={id} value={value} onChange={onChange} />
    </label>
  ),
}));

vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary", TEXT: "text" },
}));

vi.mock("@api", () => ({
  useGetRoadmapStrategyContextQuery: () => ({ data: state.page, isLoading: false }),
  useUpdateRoadmapStrategyContextMutation: () => [
    (body: unknown) => ({ unwrap: () => save(body) }),
    { isLoading: false },
  ],
}));

import { StrategyContextManager } from "../StrategyContextManager";

const page = (over: Record<string, unknown> = {}) => ({
  vision: "",
  audience: "",
  bets: "",
  nonGoals: "",
  metrics: "",
  updatedAt: null,
  updatedByName: null,
  ...over,
});

describe("StrategyContextManager", () => {
  beforeEach(() => {
    save.mockReset();
    save.mockResolvedValue(page());
  });

  it("says what an empty page means for the copilot", () => {
    state.page = page();
    render(<StrategyContextManager />);

    expect(screen.getByText(/can only judge strategic fit against the/)).toBeInTheDocument();
  });

  it("saves only when something changed, sending every section", async () => {
    state.page = page({ vision: "Help helpers.", updatedAt: "2026-10-01T00:00:00Z" });
    render(<StrategyContextManager />);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByText(/can only judge/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Explicit non-goals"), {
      target: { value: "No general-purpose CRM." },
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        vision: "Help helpers.",
        audience: "",
        bets: "",
        nonGoals: "No general-purpose CRM.",
        metrics: "",
      }),
    );
  });

  it("discards an unsaved edit back to the saved page", () => {
    state.page = page({ vision: "Help helpers." });
    render(<StrategyContextManager />);

    fireEvent.change(screen.getByLabelText("Product vision"), {
      target: { value: "Something else" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByLabelText("Product vision")).toHaveValue("Help helpers.");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});
