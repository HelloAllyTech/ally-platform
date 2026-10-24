import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ save: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSaveAllyGuideTurnAsEvalCaseMutation: () => [h.save, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { SaveEvalCaseButton } from "../SaveEvalCaseButton";

const openDialog = () => {
  fireEvent.click(screen.getByRole("button", { name: "Save as eval case…" }));
  return screen.getByRole("dialog", { name: "Save this turn as an eval case" });
};

describe("SaveEvalCaseButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.save.mockReturnValue({
      unwrap: () => Promise.resolve({ case: { id: "c-1" }, duplicate: false }),
    });
  });

  it("opens a dialog that says what a case is and saves nothing until confirmed", () => {
    render(<SaveEvalCaseButton turnId="turn-1" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const dialog = openDialog();

    expect(dialog).toHaveTextContent("every release is replayed against");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("defaults to a regression: Ally got this wrong and must stop", async () => {
    render(<SaveEvalCaseButton turnId="turn-1" />);
    const dialog = openDialog();
    expect(within(dialog).getByLabelText(/Ally got this wrong and must stop/)).toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }));

    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save).toHaveBeenCalledWith({
      turnId: "turn-1",
      kind: "regression",
      title: "",
      notes: "",
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("Saved as an eval case.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("saves a golden case with a title and notes", async () => {
    render(<SaveEvalCaseButton turnId="turn-1" />);
    const dialog = openDialog();

    fireEvent.click(within(dialog).getByLabelText(/Ally got this right and must keep doing so/));
    fireEvent.change(within(dialog).getByLabelText("Title (optional)"), {
      target: { value: "Gentle opening" },
    });
    fireEvent.change(within(dialog).getByLabelText("Notes (optional)"), {
      target: { value: "Keep this register" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }));

    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.save).toHaveBeenCalledWith({
      turnId: "turn-1",
      kind: "golden",
      title: "Gentle opening",
      notes: "Keep this register",
    });
  });

  it("says so when the turn is already a case, rather than reporting a new one", async () => {
    h.save.mockReturnValue({
      unwrap: () => Promise.resolve({ case: { id: "c-1" }, duplicate: true }),
    });
    render(<SaveEvalCaseButton turnId="turn-1" />);

    fireEvent.click(within(openDialog()).getByRole("button", { name: "Save case" }));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("This turn is already a case."),
    );
  });

  it("keeps the dialog open with the server's message when it cannot be saved", async () => {
    h.save.mockReturnValue({
      unwrap: () =>
        Promise.reject({
          status: 409,
          data: {
            message:
              "This turn can't be saved as a case: the learner's message named a real person",
          },
        }),
    });
    render(<SaveEvalCaseButton turnId="turn-1" />);

    fireEvent.click(within(openDialog()).getByRole("button", { name: "Save case" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "This turn can't be saved as a case: the learner's message named a real person",
      ),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("starts clean when reopened", () => {
    render(<SaveEvalCaseButton turnId="turn-1" />);
    let dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText("Title (optional)"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    dialog = openDialog();

    expect(within(dialog).getByLabelText("Title (optional)")).toHaveValue("");
  });
});
