import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { info: (...a: any[]) => toastInfo(...a), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@api", () => ({
  useGetTenantsQuery: () => ({
    data: {
      data: [
        { id: "t1", name: "This org" },
        { id: "t2", name: "Other org" },
      ],
    },
  }),
}));
vi.mock("@components/types", () => ({ ButtonVariant: { SECONDARY: "secondary" } }));
vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ConfirmDialog: ({ isOpen, consequence, confirmLabel, onConfirm }: any) =>
    isOpen ? (
      <div>
        <p>{consequence}</p>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}));

// eslint-disable-next-line import/first
import { BulkAccessBar } from "../BulkAccessBar";

describe("BulkAccessBar", () => {
  const enable = vi.fn().mockResolvedValue(undefined);
  const onDone = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  it("enable all: states the count, then enables exactly those ids", async () => {
    const fetchIds = vi.fn().mockResolvedValue([1, 2, 3]);
    render(
      <BulkAccessBar
        tenantId="t1"
        config={{ noun: "simulations", fetchIds, enable }}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByText("Enable all"));
    expect(await screen.findByText(/turns on 3 simulations/)).toBeTruthy();
    expect(fetchIds).toHaveBeenCalledWith("t1", false);
    fireEvent.click(screen.getByText("Enable 3"));
    await waitFor(() => expect(enable).toHaveBeenCalledWith([1, 2, 3]));
    expect(onDone).toHaveBeenCalled();
  });

  it("copy: only adds what this org lacks", async () => {
    const fetchIds = vi.fn(async (tenant: string) => (tenant === "t2" ? [1, 2, 3] : [2]));
    render(
      <BulkAccessBar
        tenantId="t1"
        config={{ noun: "courses", fetchIds, enable }}
        onDone={onDone}
      />,
    );
    fireEvent.change(screen.getByLabelText("Copy access from…"), { target: { value: "t2" } });
    fireEvent.click(screen.getByText("Copy"));
    fireEvent.click(await screen.findByText("Enable 2"));
    await waitFor(() => expect(enable).toHaveBeenCalledWith([1, 3]));
  });

  it("says so when there is nothing to change", async () => {
    const fetchIds = vi.fn().mockResolvedValue([]);
    render(
      <BulkAccessBar tenantId="t1" config={{ noun: "cases", fetchIds, enable }} onDone={onDone} />,
    );
    fireEvent.click(screen.getByText("Enable all"));
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(enable).not.toHaveBeenCalled();
  });
});
