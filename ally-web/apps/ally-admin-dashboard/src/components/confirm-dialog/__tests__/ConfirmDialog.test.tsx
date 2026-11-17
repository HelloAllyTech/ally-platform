import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@assets", () => ({ Close: () => <svg /> }));

// eslint-disable-next-line import/first
import { ConfirmDialog } from "../ConfirmDialog";
import { useConfirm } from "../useConfirm";

describe("ConfirmDialog", () => {
  it("reversible: no checkbox, confirm enabled", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Unassign?"
        consequence="Callers lose the bot."
        confirmLabel="Unassign"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Unassign" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("irreversible: confirm stays disabled until acknowledged", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        irreversible
        title="Delete?"
        consequence="Gone for good."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(btn).toBeEnabled();
  });

  it("useConfirm resolves true on confirm and false on cancel", async () => {
    let api!: ReturnType<typeof useConfirm>;
    const Host = () => {
      api = useConfirm();
      return <>{api.dialog}</>;
    };
    render(<Host />);
    let p!: Promise<boolean>;
    act(() => {
      p = api.confirm({ title: "T", consequence: "C", confirmLabel: "Go" });
    });
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    await expect(p).resolves.toBe(true);
    act(() => {
      p = api.confirm({ title: "T", consequence: "C", confirmLabel: "Go" });
    });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(p).resolves.toBe(false);
  });
});
