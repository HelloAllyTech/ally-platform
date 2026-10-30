import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { V2VTestModal } from "../V2VTestModal";

const getSimulations = vi.fn();

vi.mock("@api", () => ({
  useGetSimulationsQuery: (params: unknown) => getSimulations(params),
  useGetScenarioLanguagesQuery: () => ({ data: [] }),
  useStartV2VTestMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock("@components", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  CustomDropdown: ({ label, options }: any) => (
    <div data-testid={`dropdown-${label}`}>
      {options.map((o: any) => (
        <span key={o.id}>{o.value}</span>
      ))}
    </div>
  ),
}));

vi.mock("@components/types", () => ({ ButtonVariant: { TEXT: "text", PRIMARY: "primary" } }));

describe("V2VTestModal scenario picker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSimulations.mockReturnValue({
      data: { data: [{ id: 528, title: "Copy of Help Manoj" }] },
      isFetching: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    getSimulations.mockReset();
  });

  it("lists newest first and labels each option with its id", () => {
    render(<V2VTestModal open onClose={vi.fn()} />);
    expect(getSimulations).toHaveBeenLastCalledWith({ limit: 200, order: "DESC" });
    expect(screen.getByText("#528 · Copy of Help Manoj")).toBeTruthy();
  });

  it("searches every simulation on the server, not just the loaded page", () => {
    render(<V2VTestModal open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Find a scenario"), { target: { value: " Manoj " } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(getSimulations).toHaveBeenLastCalledWith({
      limit: 200,
      order: "DESC",
      search: "Manoj",
    });
  });
});
