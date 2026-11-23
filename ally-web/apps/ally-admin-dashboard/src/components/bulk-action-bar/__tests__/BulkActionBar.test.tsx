import { act, render, renderHook, screen } from "@testing-library/react";
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
import { BulkActionBar } from "../BulkActionBar";
import { useRowSelection } from "../useRowSelection";

describe("BulkActionBar / useRowSelection", () => {
  it("renders nothing with zero selected, and count + actions otherwise", async () => {
    const onClick = vi.fn();
    const { container, rerender } = render(
      <BulkActionBar count={0} actions={[]} onClear={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <BulkActionBar count={3} actions={[{ label: "Deactivate", onClick }]} onClear={vi.fn()} />,
    );
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Deactivate"));
    expect(onClick).toHaveBeenCalled();
  });

  it("toggles, selects all, clears", () => {
    const { result } = renderHook(() => useRowSelection([1, 2, 3]));
    act(() => result.current.toggle(2));
    expect(result.current.someSelected).toBe(true);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(3);
    expect(result.current.allSelected).toBe(true);
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });
});
