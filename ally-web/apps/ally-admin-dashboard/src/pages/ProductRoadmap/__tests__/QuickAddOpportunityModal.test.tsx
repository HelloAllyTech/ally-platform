import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickAddOpportunityModal } from "../QuickAddOpportunityModal";

const mockQuickAdd = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("@icons", () => ({
  Close: () => <span>close</span>,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  TextArea: ({ id, labelText, value, onChange }: any) => (
    <label>
      {labelText}
      <textarea id={id} value={value} onChange={onChange} />
    </label>
  ),
  // A native select standing in for Carbon's: enough to pick an item by value.
  CarbonDropdown: ({ id, titleText, items, selectedItem, onChange }: any) => (
    <label>
      {titleText}
      <select
        id={id}
        value={selectedItem?.value ?? ""}
        onChange={e =>
          onChange({ selectedItem: items.find((i: any) => i.value === e.target.value) })
        }
      >
        <option value="">—</option>
        {items.map((item: any) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
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
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary" },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => mockToastSuccess(message),
    error: (message: string) => mockToastError(message),
  },
}));

vi.mock("@api", () => ({
  useQuickAddRoadmapOpportunityMutation: () => [mockQuickAdd, { isLoading: false }],
}));

const GOALS = [
  { id: "g1", name: "Retention", position: 0 },
  { id: "g2", name: "Supervisor tooling", position: 1 },
];

const renderModal = (onCreated = vi.fn(), onClose = vi.fn()) =>
  render(<QuickAddOpportunityModal goals={GOALS} onClose={onClose} onCreated={onCreated} />);

describe("QuickAddOpportunityModal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cannot submit until there is a description and a product goal", () => {
    renderModal();
    const submit = screen.getByRole("button", { name: /add to roadmap/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/what is the opportunity/i), {
      target: { value: "Export cohort scores" },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/product goal/i), {
      target: { value: "Supervisor tooling" },
    });
    expect(submit).toBeEnabled();
  });

  it("files with NO readiness token or brief, then hands the new id over", async () => {
    mockQuickAdd.mockReturnValue({ unwrap: () => Promise.resolve({ id: "opp-9" }) });
    const onCreated = vi.fn();
    renderModal(onCreated);

    fireEvent.change(screen.getByLabelText(/what is the opportunity/i), {
      target: { value: "  Export cohort scores  " },
    });
    fireEvent.change(screen.getByLabelText(/product goal/i), {
      target: { value: "Retention" },
    });
    fireEvent.change(screen.getByLabelText(/size/i), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: /add to roadmap/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("opp-9"));
    expect(mockQuickAdd).toHaveBeenCalledTimes(1);
    const body = mockQuickAdd.mock.calls[0][0];
    expect(body).toEqual({
      description: "Export cohort scores",
      type: "idea",
      productGoal: "Retention",
      effort: "m",
    });
    // The whole point of the door: nothing the interview would have minted.
    expect(body).not.toHaveProperty("readinessToken");
    expect(body).not.toHaveProperty("brief");
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
  });

  it("files unsized when no size is picked", async () => {
    mockQuickAdd.mockReturnValue({ unwrap: () => Promise.resolve({ id: "opp-1" }) });
    renderModal();

    fireEvent.change(screen.getByLabelText(/what is the opportunity/i), {
      target: { value: "Export cohort scores" },
    });
    fireEvent.change(screen.getByLabelText(/product goal/i), {
      target: { value: "Retention" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add to roadmap/i }));

    await waitFor(() => expect(mockQuickAdd).toHaveBeenCalledTimes(1));
    expect(mockQuickAdd.mock.calls[0][0].effort).toBeNull();
  });

  it("surfaces the server's refusal and stays open", async () => {
    mockQuickAdd.mockReturnValue({
      unwrap: () =>
        Promise.reject({ data: { message: "Only a roadmap manager can assign an owner." } }),
    });
    const onCreated = vi.fn();
    renderModal(onCreated);

    fireEvent.change(screen.getByLabelText(/what is the opportunity/i), {
      target: { value: "Export cohort scores" },
    });
    fireEvent.change(screen.getByLabelText(/product goal/i), {
      target: { value: "Retention" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add to roadmap/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockToastError).toHaveBeenCalledWith("Only a roadmap manager can assign an owner.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes from the overlay and the close button", () => {
    const onClose = vi.fn();
    renderModal(vi.fn(), onClose);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
